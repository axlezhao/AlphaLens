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

export const watchlists = sqliteTable("watchlists", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => [index("watchlists_workspace_idx").on(t.workspaceId, t.updatedAt)]);

export const watchlistItems = sqliteTable("watchlist_items", {
  watchlistId: text("watchlist_id").notNull().references(() => watchlists.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  addedByUserId: text("added_by_user_id").notNull().references(() => users.id),
  priority: integer("priority").notNull().default(0),
  notes: text("notes"),
  addedAt: text("added_at").notNull(),
}, (t) => [primaryKey({ columns: [t.watchlistId, t.securityId] }), index("watchlist_items_security_idx").on(t.securityId)]);

export const thesisFalsifiers = sqliteTable("thesis_falsifiers", {
  id: text("id").primaryKey(),
  logicalId: text("logical_id").notNull(),
  version: integer("version").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  thesisLogicalId: text("thesis_logical_id").notNull(),
  label: text("label").notNull(),
  metric: text("metric"),
  operator: text("operator", { enum: ["lt", "lte", "gt", "gte", "eq", "manual"] }).notNull().default("manual"),
  threshold: real("threshold"),
  unit: text("unit"),
  evaluationWindow: text("evaluation_window"),
  status: text("status", { enum: ["untriggered", "warning", "triggered", "retired"] }).notNull().default("untriggered"),
  currentValue: real("current_value"),
  note: text("note"),
  supersedesId: text("supersedes_id"),
  asOf: text("as_of").notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("thesis_falsifiers_logical_version_uq").on(t.logicalId, t.version), index("thesis_falsifiers_thesis_idx").on(t.workspaceId, t.thesisLogicalId, t.updatedAt)]);

export const earningsWorkflows = sqliteTable("earnings_workflows", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id),
  workflowType: text("workflow_type", { enum: ["preview", "deep_dive"] }).notNull(),
  fiscalPeriod: text("fiscal_period").notNull(),
  eventAt: text("event_at"),
  status: text("status", { enum: ["draft", "queued", "running", "succeeded", "failed", "cancelled"] }).notNull(),
  researchJobId: text("research_job_id").references(() => researchJobs.id),
  expectationsJson: text("expectations_json").notNull().default("{}"),
  outputJson: text("output_json"),
  asOf: text("as_of").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  ...timestamps,
}, (t) => [uniqueIndex("earnings_workflows_idempotency_uq").on(t.workspaceId, t.idempotencyKey), index("earnings_workflows_security_idx").on(t.securityId, t.eventAt)]);

export const catalystSubscriptions = sqliteTable("catalyst_subscriptions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  refreshIntervalMinutes: integer("refresh_interval_minutes").notNull().default(360),
  lastRefreshAt: text("last_refresh_at"),
  nextRefreshAt: text("next_refresh_at").notNull(),
  lastStatus: text("last_status", { enum: ["never", "healthy", "degraded", "failed"] }).notNull().default("never"),
  lastError: text("last_error"),
  ...timestamps,
}, (t) => [uniqueIndex("catalyst_subscriptions_workspace_security_uq").on(t.workspaceId, t.securityId), index("catalyst_subscriptions_due_idx").on(t.enabled, t.nextRefreshAt)]);

export const notificationChannels = sqliteTable("notification_channels", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelType: text("channel_type", { enum: ["email", "wecom_webhook", "wechat_official"] }).notNull(),
  label: text("label").notNull(),
  destinationHint: text("destination_hint").notNull(),
  secretCiphertext: text("secret_ciphertext"),
  secretIv: text("secret_iv"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  verificationStatus: text("verification_status", { enum: ["unverified", "verified", "blocked"] }).notNull().default("unverified"),
  ...timestamps,
}, (t) => [index("notification_channels_workspace_idx").on(t.workspaceId, t.userId)]);

export const notificationRules = sqliteTable("notification_rules", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => notificationChannels.id, { onDelete: "cascade" }),
  securityId: text("security_id").references(() => securities.id, { onDelete: "cascade" }),
  eventTypesJson: text("event_types_json").notNull().default("[]"),
  leadMinutes: integer("lead_minutes").notNull().default(1440),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  ...timestamps,
}, (t) => [index("notification_rules_workspace_idx").on(t.workspaceId, t.enabled)]);

export const notificationOutbox = sqliteTable("notification_outbox", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: text("channel_id").notNull().references(() => notificationChannels.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  payloadJson: text("payload_json").notNull().default("{}"),
  status: text("status", { enum: ["queued", "sending", "delivered", "failed", "cancelled"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: text("next_attempt_at").notNull(),
  providerMessageId: text("provider_message_id"),
  deliveredAt: text("delivered_at"),
  errorMessage: text("error_message"),
  ...timestamps,
}, (t) => [uniqueIndex("notification_outbox_event_uq").on(t.channelId, t.eventKey), index("notification_outbox_queue_idx").on(t.status, t.nextAttemptAt)]);

export const peerGroups = sqliteTable("peer_groups", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  anchorSecurityId: text("anchor_security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  metricKeysJson: text("metric_keys_json").notNull().default("[]"),
  ...timestamps,
}, (t) => [index("peer_groups_anchor_idx").on(t.workspaceId, t.anchorSecurityId)]);

export const peerGroupMembers = sqliteTable("peer_group_members", {
  peerGroupId: text("peer_group_id").notNull().references(() => peerGroups.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  metricsJson: text("metrics_json").notNull().default("{}"),
  metricsAsOf: text("metrics_as_of"),
  sourceId: text("source_id").references(() => sources.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [primaryKey({ columns: [t.peerGroupId, t.securityId] })]);

export const reviewTemplates = sqliteTable("review_templates", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  schemaJson: text("schema_json").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
}, (t) => [index("review_templates_workspace_idx").on(t.workspaceId)]);

export const investmentReviews = sqliteTable("investment_reviews", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  securityId: text("security_id").notNull().references(() => securities.id),
  templateId: text("template_id").references(() => reviewTemplates.id),
  thesisLogicalId: text("thesis_logical_id"),
  reviewType: text("review_type", { enum: ["decision", "earnings", "position", "closed_trade"] }).notNull(),
  decision: text("decision").notNull(),
  confidence: real("confidence").notNull(),
  expectedOutcome: text("expected_outcome"),
  actualOutcome: text("actual_outcome"),
  outcomeScore: real("outcome_score"),
  biasesJson: text("biases_json").notNull().default("[]"),
  lessons: text("lessons"),
  nextAction: text("next_action"),
  asOf: text("as_of").notNull(),
  ...timestamps,
}, (t) => [index("investment_reviews_workspace_user_idx").on(t.workspaceId, t.userId, t.createdAt)]);
