import assert from "node:assert/strict";
import test from "node:test";
import { arbitrateCandidates, explainQuality, routeProviders, validateSkillManifest, validateWorkflow } from "../lib/platform/analytics.ts";
import { validateWebhookUrl } from "../lib/platform/webhook-security.ts";

test("workflow validation accepts a bounded DAG and rejects cycles", () => {
  assert.equal(validateWorkflow({ nodes: [{ id: "facts", type: "agent", role: "analyst", objective: "verify facts" }, { id: "review", type: "arbitration", dependsOn: ["facts"] }] }).valid, true);
  const cyclic = validateWorkflow({ nodes: [{ id: "left", type: "agent", role: "a", objective: "a", dependsOn: ["right"] }, { id: "right", type: "agent", role: "b", objective: "b", dependsOn: ["left"] }] });
  assert.equal(cyclic.valid, false); assert.match(cyclic.errors.join(" "), /循环/);
});

test("skill manifest enforces semver and least-privilege network/write scopes", () => {
  const valid = validateSkillManifest({ name: "thesis-challenger", description: "Independent challenge", version: "1.0.0", category: "quality", inputs: ["thesis"], outputs: ["challenge"], permissions: { network: ["sec.gov"], write: ["workspace/research"] } });
  assert.equal(valid.valid, true);
  const unsafe = validateSkillManifest({ name: "unsafe", description: "unsafe", version: "v1", category: "quality", inputs: [], outputs: [], permissions: { network: ["*"], write: ["system/secrets"] } });
  assert.equal(unsafe.valid, false); assert.equal(unsafe.errors.length, 3);
});

test("provider router honors capability, license, health and freshness before priority", () => {
  const routes = [
    { provider: "fast-but-open", category: "filings", capability: "filings", priority: 1, enabled: true, licenseScope: "test", allowedUse: "research", freshnessSeconds: 60, health: "open" as const },
    { provider: "display-only", category: "filings", capability: "filings", priority: 2, enabled: true, licenseScope: "test", allowedUse: "display", freshnessSeconds: 60, health: "healthy" as const },
    { provider: "authorized", category: "filings", capability: "filings", priority: 20, enabled: true, licenseScope: "test", allowedUse: "research", freshnessSeconds: 300, health: "healthy" as const },
    { provider: "fallback", category: "filings", capability: "filings", priority: 30, enabled: true, licenseScope: "test", allowedUse: "research", freshnessSeconds: 600, health: "degraded" as const },
  ];
  const result = routeProviders(routes, { capability: "filings", use: "research", requireFreshnessSeconds: 900 });
  assert.equal(result.selected?.provider, "authorized"); assert.equal(result.fallbacks[0]?.provider, "fallback"); assert.equal(result.rejected.length, 2);
});

test("multi-agent arbitration preserves explainable scores and dissent", () => {
  const result = arbitrateCandidates([
    { id: "facts", role: "filing_analyst", output: {}, evidenceCount: 8, primarySourceCount: 7, contradictionsAddressed: 2, staleSourceCount: 0, reasoningSignals: 5 },
    { id: "challenge", role: "risk_challenger", output: {}, evidenceCount: 7, primarySourceCount: 6, contradictionsAddressed: 3, staleSourceCount: 0, reasoningSignals: 5 },
  ]);
  assert.equal(result.scores.length, 2); assert.ok(result.winner); assert.ok(result.explanation.length >= 2); assert.ok(result.dissent.length >= 1);
});

test("quality benchmark fails temporal leakage even when evidence is otherwise strong", () => {
  const result = explainQuality({ citations: 20, primaryCitations: 20, contradictions: 4, staleSources: 0, unsupportedClaims: 0, leakageViolations: 1 });
  assert.equal(result.passed, false); assert.equal(result.dimensions.temporalIntegrity, 0); assert.ok(result.failures.some((failure) => failure.dimension === "temporalIntegrity"));
});

test("webhook guard allows public HTTPS and rejects local/private endpoints", () => {
  assert.equal(validateWebhookUrl("https://hooks.example.com/alphalens"), "https://hooks.example.com/alphalens");
  for (const value of ["http://hooks.example.com/a", "https://localhost/a", "https://127.0.0.1/a", "https://10.0.0.2/a", "https://service.internal/a"]) assert.throws(() => validateWebhookUrl(value));
});
