import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  deletionRequestedAt: text("deletion_requested_at"),
  ...timestamps,
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  ...timestamps,
});

export const workspaceMembers = sqliteTable("workspace_members", {
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "editor", "viewer"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)]);

export const portfolios = sqliteTable("portfolios", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD"),
  ...timestamps,
}, (t) => [index("portfolios_workspace_idx").on(t.workspaceId)]);

export const securities = sqliteTable("securities", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  exchange: text("exchange").notNull().default("US"),
  cik: text("cik"),
  issuerName: text("issuer_name"),
  irBaseUrl: text("ir_base_url"),
  irFeedUrl: text("ir_feed_url"),
  ...timestamps,
}, (t) => [uniqueIndex("securities_workspace_ticker_uq").on(t.workspaceId, t.ticker, t.exchange)]);

export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  sourceType: text("source_type", { enum: ["sec", "ir", "market", "consensus", "user"] }).notNull(),
  title: text("title").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  publisher: text("publisher").notNull(),
  publishedAt: text("published_at"),
  accessedAt: text("accessed_at").notNull(),
  asOf: text("as_of").notNull(),
  staleAt: text("stale_at").notNull(),
  isStale: integer("is_stale", { mode: "boolean" }).notNull().default(false),
  licenseScope: text("license_scope").notNull(),
  contentHash: text("content_hash").notNull(),
  metadataJson: text("metadata_json").notNull().default("{}"),
  ...timestamps,
}, (t) => [uniqueIndex("sources_workspace_hash_uq").on(t.workspaceId, t.contentHash), index("sources_freshness_idx").on(t.provider, t.staleAt)]);

export const evidence = sqliteTable("evidence", {
  id: text("id").primaryKey(),
  logicalId: text("logical_id").notNull(),
  version: integer("version").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull().references(() => sources.id),
  kind: text("kind", { enum: ["FACT", "EXPECTATION", "INFERENCE", "USER_VIEW", "UNVERIFIED"] }).notNull(),
  claim: text("claim").notNull(),
  excerpt: text("excerpt"),
  valueJson: text("value_json"),
  observedAt: text("observed_at").notNull(),
  asOf: text("as_of").notNull(),
  confidence: real("confidence").notNull(),
  supersedesId: text("supersedes_id"),
  contentHash: text("content_hash").notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("evidence_logical_version_uq").on(t.logicalId, t.version), uniqueIndex("evidence_workspace_hash_uq").on(t.workspaceId, t.contentHash), index("evidence_security_asof_idx").on(t.securityId, t.asOf)]);

export const theses = sqliteTable("theses", {
  id: text("id").primaryKey(),
  logicalId: text("logical_id").notNull(),
  version: integer("version").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  statement: text("statement").notNull(),
  status: text("status", { enum: ["draft", "active", "weakening", "invalidated", "closed"] }).notNull(),
  conviction: real("conviction").notNull(),
  falsifiersJson: text("falsifiers_json").notNull().default("[]"),
  supersedesId: text("supersedes_id"),
  asOf: text("as_of").notNull(),
  reviewedAt: text("reviewed_at"),
  ...timestamps,
}, (t) => [uniqueIndex("theses_logical_version_uq").on(t.logicalId, t.version), index("theses_security_idx").on(t.securityId)]);

export const thesisEvidence = sqliteTable("thesis_evidence", {
  thesisId: text("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
  evidenceId: text("evidence_id").notNull().references(() => evidence.id),
  relationship: text("relationship", { enum: ["supports", "contradicts", "context"] }).notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.thesisId, t.evidenceId] })]);

export const catalysts = sqliteTable("catalysts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  sourceId: text("source_id").references(() => sources.id),
  title: text("title").notNull(),
  eventType: text("event_type").notNull(),
  eventAt: text("event_at"),
  dateStatus: text("date_status", { enum: ["confirmed", "estimated", "unknown"] }).notNull(),
  status: text("status", { enum: ["upcoming", "occurred", "cancelled"] }).notNull(),
  asOf: text("as_of").notNull(),
  ...timestamps,
}, (t) => [index("catalysts_security_event_idx").on(t.securityId, t.eventAt)]);

export const researchJobs = sqliteTable("research_jobs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id),
  securityId: text("security_id").notNull().references(() => securities.id),
  question: text("question").notNull(),
  status: text("status", { enum: ["queued", "running", "succeeded", "failed", "cancelled"] }).notNull(),
  asOf: text("as_of").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  traceId: text("trace_id").notNull(),
  modelVersion: text("model_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  snapshotJson: text("snapshot_json"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextRunAt: text("next_run_at").notNull(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  timeoutAt: text("timeout_at").notNull(),
  cancelRequestedAt: text("cancel_requested_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  ...timestamps,
}, (t) => [uniqueIndex("research_jobs_idempotency_uq").on(t.workspaceId, t.idempotencyKey), index("research_jobs_queue_idx").on(t.status, t.nextRunAt)]);

export const researchJobEvents = sqliteTable("research_job_events", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => researchJobs.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("research_job_events_seq_uq").on(t.jobId, t.sequence)]);

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  researchJobId: text("research_job_id").references(() => researchJobs.id),
  reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id),
  verdict: text("verdict", { enum: ["approved", "changes_requested", "rejected"] }).notNull(),
  confidenceBucket: text("confidence_bucket"),
  score: real("score"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
});

export const providerState = sqliteTable("provider_state", {
  provider: text("provider").primaryKey(),
  status: text("status", { enum: ["healthy", "degraded", "open", "disabled"] }).notNull(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  circuitOpenedAt: text("circuit_opened_at"),
  lastSuccessAt: text("last_success_at"),
  lastFailureAt: text("last_failure_at"),
  lastError: text("last_error"),
  latencyMs: integer("latency_ms"),
  checkedAt: text("checked_at").notNull(),
});

export const sourceCache = sqliteTable("source_cache", {
  cacheKey: text("cache_key").primaryKey(),
  provider: text("provider").notNull(),
  bodyJson: text("body_json").notNull(),
  contentType: text("content_type").notNull(),
  fetchedAt: text("fetched_at").notNull(),
  freshUntil: text("fresh_until").notNull(),
  staleUntil: text("stale_until").notNull(),
  etag: text("etag"),
  lastModified: text("last_modified"),
}, (t) => [index("source_cache_provider_idx").on(t.provider, t.freshUntil)]);

export const modelCalls = sqliteTable("model_calls", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  researchJobId: text("research_job_id").notNull().references(() => researchJobs.id, { onDelete: "cascade" }),
  traceId: text("trace_id").notNull(),
  modelVersion: text("model_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  provider: text("provider").notNull(),
  requestHash: text("request_hash").notNull(),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  latencyMs: integer("latency_ms"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  status: text("status").notNull(),
  errorCode: text("error_code"),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id"),
  actorUserId: text("actor_user_id"),
  action: text("action").notNull(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id"),
  requestId: text("request_id").notNull(),
  ipHash: text("ip_hash"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
}, (t) => [index("audit_logs_workspace_created_idx").on(t.workspaceId, t.createdAt)]);

export const deletionRequests = sqliteTable("deletion_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status", { enum: ["requested", "processing", "completed", "rejected"] }).notNull(),
  requestedAt: text("requested_at").notNull(),
  completedAt: text("completed_at"),
  reason: text("reason"),
});
