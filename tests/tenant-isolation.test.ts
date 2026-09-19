import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { POST as enqueueResearch } from "../app/api/v1/research/route";
import { GET as getResearchJob, DELETE as cancelResearchJob } from "../app/api/v1/research/[jobId]/route";
import { GET as getJobEvents } from "../app/api/v1/research/[jobId]/events/route";
import { GET as getPortfolio, POST as mutatePortfolioRoute } from "../app/api/v1/portfolio/route";
import { GET as getPlatformRun } from "../app/api/v1/platform/runs/[runId]/route";
import { POST as researchWorker } from "../app/api/internal/research-worker/route";
import { GET as openGetRun } from "../app/api/open/v1/runs/[runId]/route";
import {
  EDITOR_A, OWNER_A, OWNER_B, VIEWER_A, WORKER_SECRET, addMember, apiRequest, asUser, auditRows,
  defaultPortfolioId, getDb, installHarness, provisionTenant, responseBody, seedApiClient, teardownHarness,
} from "./helpers/tenant-harness";

const QUESTION = "Is the current valuation supported by fundamentals?";

async function createJob(ticker: string, headers?: Record<string, string>) {
  const response = await enqueueResearch(apiRequest("/api/v1/research", { method: "POST", headers, body: { ticker, question: QUESTION } }));
  assert.equal(response.status, 202);
  const body = await responseBody(response);
  return (body?.data as Record<string, unknown>)?.id as string;
}

describe("dual-tenant research isolation (A3.2)", () => {
  let tenantA: { userId: string; workspaceId: string };
  let tenantB: { userId: string; workspaceId: string };
  let jobA: string;
  let jobB: string;

  before(async () => {
    installHarness();
    tenantA = await provisionTenant(OWNER_A);
    tenantB = await provisionTenant(OWNER_B);
    await addMember(tenantA.workspaceId, VIEWER_A, "viewer");
    await addMember(tenantA.workspaceId, EDITOR_A, "editor");
    asUser(OWNER_A);
    jobA = await createJob("NVDA");
    asUser(OWNER_B);
    jobB = await createJob("MSFT");
  });
  after(() => teardownHarness());

  it("enforces the role matrix on research enqueue", async () => {
    const asTenantA = { "x-alphalens-workspace": tenantA.workspaceId };
    asUser(VIEWER_A);
    const viewer = await enqueueResearch(apiRequest("/api/v1/research", { method: "POST", headers: asTenantA, body: { ticker: "AMD", question: QUESTION } }));
    assert.equal(viewer.status, 403);

    asUser(EDITOR_A);
    const editor = await enqueueResearch(apiRequest("/api/v1/research", { method: "POST", headers: asTenantA, body: { ticker: "AMD", question: QUESTION } }));
    assert.equal(editor.status, 202);
  });

  it("enforces the role matrix on research cancel", async () => {
    const asTenantA = { "x-alphalens-workspace": tenantA.workspaceId };
    asUser(EDITOR_A);
    const ownJob = await createJob("INTC", asTenantA);

    asUser(VIEWER_A);
    const viewer = await cancelResearchJob(apiRequest(`/api/v1/research/${ownJob}`, { method: "DELETE", headers: asTenantA }), { params: Promise.resolve({ jobId: ownJob }) });
    assert.equal(viewer.status, 403);

    asUser(EDITOR_A);
    const editor = await cancelResearchJob(apiRequest(`/api/v1/research/${ownJob}`, { method: "DELETE", headers: asTenantA }), { params: Promise.resolve({ jobId: ownJob }) });
    assert.equal(editor.status, 200);
  });

  it("hides foreign jobs behind the same 404 as missing jobs", async () => {
    asUser(OWNER_A);
    const own = await getResearchJob(apiRequest(`/api/v1/research/${jobA}`), { params: Promise.resolve({ jobId: jobA }) });
    assert.equal(own.status, 200);
    const foreign = await getResearchJob(apiRequest(`/api/v1/research/${jobB}`), { params: Promise.resolve({ jobId: jobB }) });
    assert.equal(foreign.status, 404);
    const missing = await getResearchJob(apiRequest("/api/v1/research/job_missing"), { params: Promise.resolve({ jobId: "job_missing" }) });
    assert.equal(missing.status, 404);
    assert.equal(((await responseBody(foreign))?.error as Record<string, unknown>)?.code, ((await responseBody(missing))?.error as Record<string, unknown>)?.code);
  });

  it("never lets one tenant cancel another tenant's job", async () => {
    asUser(OWNER_A);
    const response = await cancelResearchJob(apiRequest(`/api/v1/research/${jobB}`, { method: "DELETE" }), { params: Promise.resolve({ jobId: jobB }) });
    assert.equal(response.status, 409);

    asUser(OWNER_B);
    const stillQueued = await getResearchJob(apiRequest(`/api/v1/research/${jobB}`), { params: Promise.resolve({ jobId: jobB }) });
    const body = await responseBody(stillQueued);
    assert.equal((body?.data as Record<string, unknown>)?.status, "queued");
  });

  it("scopes job events to the owning workspace", async () => {
    asUser(OWNER_A);
    const foreign = await getJobEvents(apiRequest(`/api/v1/research/${jobB}/events`), { params: Promise.resolve({ jobId: jobB }) });
    assert.equal(foreign.status, 404);

    asUser(OWNER_B);
    const own = await getJobEvents(apiRequest(`/api/v1/research/${jobB}/events`), { params: Promise.resolve({ jobId: jobB }) });
    assert.equal(own.status, 200);
    assert.match(await own.text(), /event: queued/);
  });

  it("ignores forged workspace fields in the request body", async () => {
    asUser(OWNER_A);
    const response = await enqueueResearch(apiRequest("/api/v1/research", {
      method: "POST",
      body: { ticker: "CRM", question: QUESTION, workspaceId: tenantB.workspaceId, userId: tenantB.userId, role: "owner" },
    }));
    assert.equal(response.status, 202);
    const id = ((await responseBody(response))?.data as Record<string, unknown>)?.id as string;
    const row = await getDb().prepare("SELECT workspace_id AS workspaceId, requested_by_user_id AS requestedBy FROM research_jobs WHERE id=?").bind(id).first<{ workspaceId: string; requestedBy: string }>();
    assert.equal(row?.workspaceId, tenantA.workspaceId);
    assert.equal(row?.requestedBy, tenantA.userId);
  });
});

describe("dual-tenant portfolio isolation (A3.2)", () => {
  let tenantB: { workspaceId: string };
  let portfolioB: string;

  before(async () => {
    installHarness();
    await provisionTenant(OWNER_A);
    tenantB = await provisionTenant(OWNER_B);
    asUser(OWNER_B);
    const response = await getPortfolio(apiRequest("/api/v1/portfolio"));
    assert.equal(response.status, 200);
    portfolioB = (await defaultPortfolioId(tenantB.workspaceId)) as string;
    assert.ok(portfolioB);
  });
  after(() => teardownHarness());

  it("answers 404 when a portfolio id belongs to another tenant", async () => {
    asUser(OWNER_A);
    const response = await getPortfolio(apiRequest(`/api/v1/portfolio?portfolioId=${portfolioB}`));
    assert.equal(response.status, 404);
    const body = await responseBody(response);
    assert.equal((body?.error as Record<string, unknown>)?.code, "PORTFOLIO_NOT_FOUND");
  });

  it("rejects cross-tenant portfolio mutation attempts", async () => {
    asUser(OWNER_A);
    const response = await mutatePortfolioRoute(apiRequest("/api/v1/portfolio", { method: "POST", body: { portfolioId: portfolioB, action: "position.upsert" } }));
    assert.equal(response.status, 404);

    const untouched = await getDb().prepare("SELECT COUNT(*) AS count FROM portfolio_positions WHERE workspace_id=?").bind(tenantB.workspaceId).first<{ count: number }>();
    assert.equal(untouched?.count, 0);
  });
});

describe("platform run and open API isolation (A3.2)", () => {
  let tenantA: { userId: string; workspaceId: string };
  let tenantB: { userId: string; workspaceId: string };
  let runA: string;

  before(async () => {
    installHarness();
    tenantA = await provisionTenant(OWNER_A);
    tenantB = await provisionTenant(OWNER_B);

    // Trigger default workflow seeding for tenant A, then create a run row.
    asUser(OWNER_A);
    const { GET: getPlatform } = await import("../app/api/v1/platform/route");
    const platform = await getPlatform(apiRequest("/api/v1/platform"));
    assert.equal(platform.status, 200);
    const version = await getDb().prepare("SELECT rv.id FROM research_workflow_versions rv JOIN research_workflows r ON r.id=rv.workflow_id WHERE r.workspace_id=? LIMIT 1").bind(tenantA.workspaceId).first<{ id: string }>();
    assert.ok(version?.id);
    runA = crypto.randomUUID();
    const now = new Date().toISOString();
    await getDb().prepare("INSERT INTO workflow_runs (id,workspace_id,workflow_version_id,requested_by_user_id,status,input_json,as_of,idempotency_key,trace_id,created_at,updated_at) VALUES (?,?,?,?,'queued','{}',?,?,?,?,?)")
      .bind(runA, tenantA.workspaceId, version.id, tenantA.userId, now, `idem-${runA}`, crypto.randomUUID(), now, now)
      .run();
  });
  after(() => teardownHarness());

  it("hides another tenant's workflow runs behind 404", async () => {
    asUser(OWNER_B);
    const foreign = await getPlatformRun(apiRequest(`/api/v1/platform/runs/${runA}`), { params: Promise.resolve({ runId: runA }) });
    assert.equal(foreign.status, 404);
    const missing = await getPlatformRun(apiRequest("/api/v1/platform/runs/run_missing"), { params: Promise.resolve({ runId: "run_missing" }) });
    assert.equal(missing.status, 404);
    assert.equal(((await responseBody(foreign))?.error as Record<string, unknown>)?.code, ((await responseBody(missing))?.error as Record<string, unknown>)?.code);
  });

  it("binds open API tokens to their own workspace", async () => {
    const tokenB = "alp_test_token_tenant_b";
    await seedApiClient({ email: OWNER_B, ...tenantB }, tokenB, ["research:read"]);

    const foreign = await openGetRun(apiRequest(`/api/open/v1/runs/${runA}`, { headers: { authorization: `Bearer ${tokenB}` } }), { params: Promise.resolve({ runId: runA }) });
    assert.equal(foreign.status, 404);

    // Token B can read a run only if it belongs to workspace B; here it simply must not see A's run.
    const invalid = await openGetRun(apiRequest(`/api/open/v1/runs/${runA}`, { headers: { authorization: "Bearer alp_wrong_token" } }), { params: Promise.resolve({ runId: runA }) });
    assert.equal(invalid.status, 401);
  });

  it("enforces open API scopes on the server", async () => {
    const tokenNoScope = "alp_test_token_no_scope";
    await seedApiClient({ email: OWNER_B, ...tenantB }, tokenNoScope, ["portfolio:read"]);
    const response = await openGetRun(apiRequest(`/api/open/v1/runs/${runA}`, { headers: { authorization: `Bearer ${tokenNoScope}` } }), { params: Promise.resolve({ runId: runA }) });
    assert.equal(response.status, 403);
    const body = await responseBody(response);
    assert.equal((body?.error as Record<string, unknown>)?.code, "INSUFFICIENT_SCOPE");
  });
});

describe("internal worker boundary (A3.2)", () => {
  let tenantB: { userId: string; workspaceId: string };
  let jobB: string;

  before(async () => {
    installHarness();
    await provisionTenant(OWNER_A);
    tenantB = await provisionTenant(OWNER_B);
    asUser(OWNER_B);
    jobB = await createJob("AAPL");
  });
  after(() => teardownHarness());

  it("rejects bad worker credentials when the fixture bypass is off", async () => {
    delete process.env.ALPHALENS_FIXTURE_MODE;
    try {
      const response = await researchWorker(apiRequest("/api/internal/research-worker", { method: "POST", headers: { authorization: "Bearer wrong-secret" } }));
      assert.equal(response.status, 401);
    } finally {
      process.env.ALPHALENS_FIXTURE_MODE = "true";
    }
  });

  it("derives workspace ownership from claimed rows, never from caller input", async () => {
    // Even if the caller asks for another workspace, the worker claims queued
    // rows globally and executes them under their own tenant.
    const response = await researchWorker(apiRequest("/api/internal/research-worker", {
      method: "POST",
      headers: { authorization: `Bearer ${WORKER_SECRET}`, "x-workspace-id": "wsp_forged" },
    }));
    assert.equal(response.status, 200);

    const job = await getDb().prepare("SELECT status, workspace_id AS workspaceId, snapshot_json AS snapshotJson FROM research_jobs WHERE id=?").bind(jobB).first<{ status: string; workspaceId: string; snapshotJson: string | null }>();
    assert.equal(job?.workspaceId, tenantB.workspaceId);
    assert.equal(job?.status, "succeeded");
    assert.ok(job?.snapshotJson?.includes("fixture"), "fixture worker must produce clearly marked synthetic snapshots");

    asUser(OWNER_A);
    const foreign = await getResearchJob(apiRequest(`/api/v1/research/${jobB}`), { params: Promise.resolve({ jobId: jobB }) });
    assert.equal(foreign.status, 404);
  });
});

describe("denied access auditing (A3.2)", () => {
  before(async () => {
    installHarness();
    await provisionTenant(OWNER_A);
  });
  after(() => teardownHarness());

  it("stores no credential material in audit rows", async () => {
    asUser(OWNER_A);
    const { GET: getWorkbench } = await import("../app/api/v1/workbench/route");
    await getWorkbench(apiRequest("/api/v1/workbench", {
      headers: { "x-alphalens-workspace": "wsp_nonexistent", authorization: "Bearer alp_secret_marker", cookie: "mycookie=secret_marker" },
    }));
    const rows = await auditRows();
    assert.ok(rows.length >= 1);
    const serialized = JSON.stringify(rows);
    assert.ok(!serialized.includes("secret_marker"));
    assert.ok(!serialized.includes("Bearer"));
    assert.ok(!serialized.includes("cookie"), "cookie header must never be persisted");
  });
});
