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
  deletedAt: text("deleted_at"),
  ...timestamps,
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  deletedAt: text("deleted_at"),
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
  status: text("status", { enum: ["queued", "running", "retrying", "succeeded", "failed", "cancelled"] }).notNull(),
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
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  timeoutAt: text("timeout_at").notNull(),
  cancelRequestedAt: text("cancel_requested_at"),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  eventSeq: integer("event_seq").notNull().default(0),
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
}, (t) => [
  index("audit_logs_workspace_created_idx").on(t.workspaceId, t.createdAt),
  index("audit_logs_actor_created_idx").on(t.actorUserId, t.createdAt),
]);

export const deletionRequests = sqliteTable("deletion_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status", { enum: ["requested", "processing", "completed", "rejected", "cancelled"] }).notNull(),
  requestedAt: text("requested_at").notNull(),
  completedAt: text("completed_at"),
  reason: text("reason"),
  scheduledFor: text("scheduled_for"),
  nextAttemptAt: text("next_attempt_at"),
  idempotencyKey: text("idempotency_key"),
  confirmationText: text("confirmation_text"),
  cancelledAt: text("cancelled_at"),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  leaseOwner: text("lease_owner"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: text("lease_expires_at"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  startedAt: text("started_at"),
}, (t) => [uniqueIndex("deletion_requests_user_open_uq").on(t.userId)]);

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
  status: text("status", { enum: ["queued", "sending", "delivered", "failed", "dead_letter", "cancelled"] }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  nextAttemptAt: text("next_attempt_at").notNull(),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: text("lease_expires_at"),
  idempotencyKey: text("idempotency_key"),
  providerMessageId: text("provider_message_id"),
  deliveredAt: text("delivered_at"),
  deadLetteredAt: text("dead_lettered_at"),
  errorCode: text("error_code"),
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

export const portfolioPositions = sqliteTable("portfolio_positions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  positionType: text("position_type", { enum: ["long", "short", "watch"] }).notNull(),
  shares: real("shares").notNull().default(0),
  averageCost: real("average_cost"),
  currentPrice: real("current_price"),
  priceAsOf: text("price_as_of"),
  marketValue: real("market_value"),
  currency: text("currency").notNull().default("USD"),
  benchmarkWeight: real("benchmark_weight"),
  beta: real("beta"),
  dailyVolatility: real("daily_volatility"),
  advUsd: real("adv_usd"),
  sector: text("sector"),
  industry: text("industry"),
  factorExposuresJson: text("factor_exposures_json").notNull().default("{}"),
  eventTagsJson: text("event_tags_json").notNull().default("[]"),
  sourceId: text("source_id").references(() => sources.id),
  dataStatus: text("data_status", { enum: ["current", "stale", "user_input", "missing"] }).notNull().default("user_input"),
  ...timestamps,
}, (t) => [uniqueIndex("portfolio_positions_security_uq").on(t.portfolioId, t.securityId, t.positionType), index("portfolio_positions_workspace_idx").on(t.workspaceId, t.portfolioId)]);

export const portfolioRiskPolicies = sqliteTable("portfolio_risk_policies", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  nav: real("nav").notNull().default(0),
  maxPositionWeight: real("max_position_weight").notNull().default(0.2),
  maxSectorWeight: real("max_sector_weight").notNull().default(0.4),
  maxFactorExposure: real("max_factor_exposure").notNull().default(0.5),
  maxEventClusterWeight: real("max_event_cluster_weight").notNull().default(0.35),
  scenarioLossBudgetBps: integer("scenario_loss_budget_bps").notNull().default(1000),
  absoluteLossCapBps: integer("absolute_loss_cap_bps").notNull().default(2000),
  correlationLookbackDays: integer("correlation_lookback_days").notNull().default(60),
  exitParticipationRate: real("exit_participation_rate").notNull().default(0.1),
  rulesJson: text("rules_json").notNull().default("{}"),
  ...timestamps,
}, (t) => [uniqueIndex("portfolio_risk_policies_portfolio_uq").on(t.portfolioId), index("portfolio_risk_policies_workspace_idx").on(t.workspaceId)]);

export const portfolioReturnSeries = sqliteTable("portfolio_return_series", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  securityId: text("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  tradingDate: text("trading_date").notNull(),
  returnValue: real("return_value").notNull(),
  sourceId: text("source_id").references(() => sources.id),
  asOf: text("as_of").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("portfolio_returns_security_date_uq").on(t.portfolioId, t.securityId, t.tradingDate), index("portfolio_returns_portfolio_date_idx").on(t.portfolioId, t.tradingDate)]);

export const portfolioCorrelationSnapshots = sqliteTable("portfolio_correlation_snapshots", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  asOf: text("as_of").notNull(),
  lookbackDays: integer("lookback_days").notNull(),
  method: text("method").notNull().default("pearson"),
  matrixJson: text("matrix_json").notNull(),
  coverage: real("coverage").notNull(),
  warningsJson: text("warnings_json").notNull().default("[]"),
  inputHash: text("input_hash").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("portfolio_correlation_input_uq").on(t.portfolioId, t.inputHash), index("portfolio_correlation_asof_idx").on(t.portfolioId, t.asOf)]);

export const portfolioScenarios = sqliteTable("portfolio_scenarios", {
  id: text("id").primaryKey(), logicalId: text("logical_id").notNull(), version: integer("version").notNull(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  name: text("name").notNull(), description: text("description"), shocksJson: text("shocks_json").notNull(),
  status: text("status", { enum: ["draft", "active", "retired"] }).notNull().default("active"),
  supersedesId: text("supersedes_id"), asOf: text("as_of").notNull(), ...timestamps,
}, (t) => [uniqueIndex("portfolio_scenarios_version_uq").on(t.logicalId, t.version), index("portfolio_scenarios_portfolio_idx").on(t.portfolioId, t.updatedAt)]);

export const portfolioScenarioResults = sqliteTable("portfolio_scenario_results", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").notNull().references(() => portfolioScenarios.id, { onDelete: "cascade" }),
  asOf: text("as_of").notNull(), inputHash: text("input_hash").notNull(), resultJson: text("result_json").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("portfolio_scenario_results_input_uq").on(t.portfolioId, t.scenarioId, t.inputHash), index("portfolio_scenario_results_asof_idx").on(t.portfolioId, t.asOf)]);

export const portfolioRiskSnapshots = sqliteTable("portfolio_risk_snapshots", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  asOf: text("as_of").notNull(), inputHash: text("input_hash").notNull(), metricsJson: text("metrics_json").notNull(),
  exposuresJson: text("exposures_json").notNull(), concentrationJson: text("concentration_json").notNull(),
  liquidityJson: text("liquidity_json").notNull(), warningsJson: text("warnings_json").notNull().default("[]"),
  modelVersion: text("model_version").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("portfolio_risk_snapshots_input_uq").on(t.portfolioId, t.inputHash), index("portfolio_risk_snapshots_asof_idx").on(t.portfolioId, t.asOf)]);

export const portfolioActionConditions = sqliteTable("portfolio_action_conditions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  portfolioId: text("portfolio_id").notNull().references(() => portfolios.id, { onDelete: "cascade" }),
  securityId: text("security_id").references(() => securities.id, { onDelete: "cascade" }),
  conditionType: text("condition_type", { enum: ["review", "add", "trim", "exit", "hedge", "re_underwrite"] }).notNull(),
  triggerKind: text("trigger_kind", { enum: ["thesis_status", "falsifier", "risk_budget", "exposure", "correlation", "event", "manual"] }).notNull(),
  severity: text("severity", { enum: ["info", "warning", "critical"] }).notNull(),
  predicateJson: text("predicate_json").notNull(), message: text("message").notNull(),
  status: text("status", { enum: ["active", "triggered", "acknowledged", "retired"] }).notNull().default("active"),
  idempotencyKey: text("idempotency_key").notNull(), triggeredAt: text("triggered_at"), acknowledgedAt: text("acknowledged_at"),
  asOf: text("as_of").notNull(), ...timestamps,
}, (t) => [uniqueIndex("portfolio_action_conditions_idempotency_uq").on(t.portfolioId, t.idempotencyKey), index("portfolio_action_conditions_status_idx").on(t.portfolioId, t.status, t.updatedAt)]);

export const researchWorkflows = sqliteTable("research_workflows", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(), name: text("name").notNull(), description: text("description"), ownerUserId: text("owner_user_id").notNull().references(() => users.id),
  visibility: text("visibility", { enum: ["private", "workspace", "marketplace"] }).notNull().default("workspace"), ...timestamps,
}, (t) => [uniqueIndex("research_workflows_workspace_slug_uq").on(t.workspaceId, t.slug), index("research_workflows_workspace_idx").on(t.workspaceId, t.updatedAt)]);

export const researchWorkflowVersions = sqliteTable("research_workflow_versions", {
  id: text("id").primaryKey(), logicalId: text("logical_id").notNull(), version: integer("version").notNull(),
  workflowId: text("workflow_id").notNull().references(() => researchWorkflows.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  semver: text("semver").notNull(), definitionJson: text("definition_json").notNull(), inputSchemaJson: text("input_schema_json").notNull().default("{}"), outputSchemaJson: text("output_schema_json").notNull().default("{}"),
  status: text("status", { enum: ["draft", "published", "deprecated"] }).notNull().default("draft"), checksum: text("checksum").notNull(), supersedesId: text("supersedes_id"), publishedAt: text("published_at"), createdByUserId: text("created_by_user_id").notNull().references(() => users.id), ...timestamps,
}, (t) => [uniqueIndex("research_workflow_versions_logical_uq").on(t.logicalId, t.version), uniqueIndex("research_workflow_versions_semver_uq").on(t.workflowId, t.semver), index("research_workflow_versions_workflow_idx").on(t.workflowId, t.status, t.updatedAt)]);

export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), workflowVersionId: text("workflow_version_id").notNull().references(() => researchWorkflowVersions.id),
  securityId: text("security_id").references(() => securities.id), requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id),
  status: text("status", { enum: ["queued", "running", "awaiting_review", "approved", "rejected", "published", "failed", "cancelled"] }).notNull(),
  inputJson: text("input_json").notNull(), contextJson: text("context_json").notNull().default("{}"), asOf: text("as_of").notNull(), idempotencyKey: text("idempotency_key").notNull(), traceId: text("trace_id").notNull(), startedAt: text("started_at"), completedAt: text("completed_at"), errorMessage: text("error_message"), ...timestamps,
}, (t) => [uniqueIndex("workflow_runs_idempotency_uq").on(t.workspaceId, t.idempotencyKey), index("workflow_runs_status_idx").on(t.status, t.updatedAt)]);

export const workflowStepRuns = sqliteTable("workflow_step_runs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), workflowRunId: text("workflow_run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
  nodeKey: text("node_key").notNull(), nodeType: text("node_type", { enum: ["agent", "arbitration", "approval", "publish"] }).notNull(), agentRole: text("agent_role"), objective: text("objective"), dependsOnJson: text("depends_on_json").notNull().default("[]"),
  status: text("status", { enum: ["pending", "queued", "running", "succeeded", "failed", "skipped", "waiting_approval"] }).notNull(), researchJobId: text("research_job_id").references(() => researchJobs.id), outputJson: text("output_json"), evidenceIdsJson: text("evidence_ids_json").notNull().default("[]"), scoreJson: text("score_json"), modelVersion: text("model_version"), promptVersion: text("prompt_version"), startedAt: text("started_at"), completedAt: text("completed_at"), errorMessage: text("error_message"), ...timestamps,
}, (t) => [uniqueIndex("workflow_step_runs_node_uq").on(t.workflowRunId, t.nodeKey), index("workflow_step_runs_status_idx").on(t.workflowRunId, t.status)]);

export const kpiModels = sqliteTable("kpi_models", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), slug: text("slug").notNull(), name: text("name").notNull(), sector: text("sector").notNull(), industry: text("industry"), ownerUserId: text("owner_user_id").notNull().references(() => users.id), ...timestamps,
}, (t) => [uniqueIndex("kpi_models_workspace_slug_uq").on(t.workspaceId, t.slug), index("kpi_models_sector_idx").on(t.workspaceId, t.sector)]);

export const kpiModelVersions = sqliteTable("kpi_model_versions", {
  id: text("id").primaryKey(), logicalId: text("logical_id").notNull(), version: integer("version").notNull(), kpiModelId: text("kpi_model_id").notNull().references(() => kpiModels.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  semver: text("semver").notNull(), metricsJson: text("metrics_json").notNull(), validationRulesJson: text("validation_rules_json").notNull().default("[]"), status: text("status", { enum: ["draft", "published", "deprecated"] }).notNull().default("draft"), checksum: text("checksum").notNull(), supersedesId: text("supersedes_id"), publishedAt: text("published_at"), createdByUserId: text("created_by_user_id").notNull().references(() => users.id), ...timestamps,
}, (t) => [uniqueIndex("kpi_model_versions_logical_uq").on(t.logicalId, t.version), uniqueIndex("kpi_model_versions_semver_uq").on(t.kpiModelId, t.semver)]);

export const providerRoutes = sqliteTable("provider_routes", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), category: text("category").notNull(), provider: text("provider").notNull(), capability: text("capability").notNull(), priority: integer("priority").notNull().default(100),
  licenseScope: text("license_scope").notNull(), allowedUse: text("allowed_use").notNull(), maxLatencyMs: integer("max_latency_ms"), maxCostUsd: real("max_cost_usd"), freshnessSeconds: integer("freshness_seconds").notNull(), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), configJson: text("config_json").notNull().default("{}"), ...timestamps,
}, (t) => [uniqueIndex("provider_routes_workspace_capability_uq").on(t.workspaceId, t.capability, t.provider), index("provider_routes_category_idx").on(t.workspaceId, t.category, t.priority)]);

export const researchSkills = sqliteTable("research_skills", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), slug: text("slug").notNull(), name: text("name").notNull(), description: text("description").notNull(), publisherUserId: text("publisher_user_id").notNull().references(() => users.id), visibility: text("visibility", { enum: ["private", "workspace", "marketplace"] }).notNull().default("workspace"), category: text("category").notNull(), ...timestamps,
}, (t) => [uniqueIndex("research_skills_workspace_slug_uq").on(t.workspaceId, t.slug), index("research_skills_marketplace_idx").on(t.visibility, t.category, t.updatedAt)]);

export const researchSkillVersions = sqliteTable("research_skill_versions", {
  id: text("id").primaryKey(), logicalId: text("logical_id").notNull(), version: integer("version").notNull(), skillId: text("skill_id").notNull().references(() => researchSkills.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), semver: text("semver").notNull(), manifestJson: text("manifest_json").notNull(), instructions: text("instructions").notNull(), inputSchemaJson: text("input_schema_json").notNull().default("{}"), outputSchemaJson: text("output_schema_json").notNull().default("{}"), permissionsJson: text("permissions_json").notNull().default("{}"), status: text("status", { enum: ["draft", "published", "deprecated", "blocked"] }).notNull().default("draft"), checksum: text("checksum").notNull(), supersedesId: text("supersedes_id"), publishedAt: text("published_at"), validationJson: text("validation_json").notNull().default("{}"), ...timestamps,
}, (t) => [uniqueIndex("research_skill_versions_logical_uq").on(t.logicalId, t.version), uniqueIndex("research_skill_versions_semver_uq").on(t.skillId, t.semver)]);

export const skillInstallations = sqliteTable("skill_installations", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), skillVersionId: text("skill_version_id").notNull().references(() => researchSkillVersions.id), installedByUserId: text("installed_by_user_id").notNull().references(() => users.id), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), grantedPermissionsJson: text("granted_permissions_json").notNull().default("{}"), installedAt: text("installed_at").notNull(), updatedAt: text("updated_at").notNull(),
}, (t) => [uniqueIndex("skill_installations_workspace_skill_uq").on(t.workspaceId, t.skillVersionId), index("skill_installations_workspace_idx").on(t.workspaceId, t.enabled)]);

export const arbitrationDecisions = sqliteTable("arbitration_decisions", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), workflowRunId: text("workflow_run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }), stepRunId: text("step_run_id").references(() => workflowStepRuns.id), rubricVersion: text("rubric_version").notNull(), selectedCandidateId: text("selected_candidate_id"), candidateScoresJson: text("candidate_scores_json").notNull(), explanationJson: text("explanation_json").notNull(), dissentJson: text("dissent_json").notNull().default("[]"), confidence: real("confidence").notNull(), asOf: text("as_of").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("arbitration_decisions_run_idx").on(t.workflowRunId, t.createdAt)]);

export const researchArtifacts = sqliteTable("research_artifacts", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), workflowRunId: text("workflow_run_id").references(() => workflowRuns.id), securityId: text("security_id").references(() => securities.id), logicalId: text("logical_id").notNull(), artifactType: text("artifact_type", { enum: ["report", "memo", "model", "dataset", "decision_card"] }).notNull(), title: text("title").notNull(), ownerUserId: text("owner_user_id").notNull().references(() => users.id), ...timestamps,
}, (t) => [uniqueIndex("research_artifacts_workspace_logical_uq").on(t.workspaceId, t.logicalId), index("research_artifacts_run_idx").on(t.workflowRunId)]);

export const researchArtifactVersions = sqliteTable("research_artifact_versions", {
  id: text("id").primaryKey(), artifactId: text("artifact_id").notNull().references(() => researchArtifacts.id, { onDelete: "cascade" }), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), version: integer("version").notNull(), contentJson: text("content_json").notNull(), sourceSnapshotJson: text("source_snapshot_json").notNull().default("{}"), checksum: text("checksum").notNull(), status: text("status", { enum: ["draft", "in_review", "approved", "rejected", "published", "superseded"] }).notNull(), asOf: text("as_of").notNull(), createdByUserId: text("created_by_user_id").notNull().references(() => users.id), supersedesId: text("supersedes_id"), publishedAt: text("published_at"), ...timestamps,
}, (t) => [uniqueIndex("research_artifact_versions_uq").on(t.artifactId, t.version), index("research_artifact_versions_status_idx").on(t.workspaceId, t.status, t.updatedAt)]);

export const teamComments = sqliteTable("team_comments", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), artifactVersionId: text("artifact_version_id").notNull().references(() => researchArtifactVersions.id, { onDelete: "cascade" }), authorUserId: text("author_user_id").notNull().references(() => users.id), parentId: text("parent_id"), anchorJson: text("anchor_json").notNull().default("{}"), body: text("body").notNull(), status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"), resolvedByUserId: text("resolved_by_user_id").references(() => users.id), resolvedAt: text("resolved_at"), ...timestamps,
}, (t) => [index("team_comments_artifact_idx").on(t.artifactVersionId, t.status, t.createdAt)]);

export const approvalRequests = sqliteTable("approval_requests", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), artifactVersionId: text("artifact_version_id").notNull().references(() => researchArtifactVersions.id, { onDelete: "cascade" }), requestedByUserId: text("requested_by_user_id").notNull().references(() => users.id), reviewerUserId: text("reviewer_user_id").references(() => users.id), requiredRole: text("required_role", { enum: ["owner", "editor"] }).notNull().default("editor"), status: text("status", { enum: ["pending", "approved", "changes_requested", "rejected", "cancelled"] }).notNull(), decisionNote: text("decision_note"), decidedByUserId: text("decided_by_user_id").references(() => users.id), decidedAt: text("decided_at"), ...timestamps,
}, (t) => [index("approval_requests_status_idx").on(t.workspaceId, t.status, t.createdAt)]);

export const benchmarkSuites = sqliteTable("benchmark_suites", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), slug: text("slug").notNull(), name: text("name").notNull(), description: text("description"), rubricJson: text("rubric_json").notNull(), version: integer("version").notNull().default(1), ownerUserId: text("owner_user_id").notNull().references(() => users.id), ...timestamps,
}, (t) => [uniqueIndex("benchmark_suites_workspace_slug_uq").on(t.workspaceId, t.slug)]);

export const benchmarkCases = sqliteTable("benchmark_cases", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), suiteId: text("suite_id").notNull().references(() => benchmarkSuites.id, { onDelete: "cascade" }), name: text("name").notNull(), inputJson: text("input_json").notNull(), expectedJson: text("expected_json").notNull(), tagsJson: text("tags_json").notNull().default("[]"), asOf: text("as_of").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [index("benchmark_cases_suite_idx").on(t.suiteId, t.createdAt)]);

export const evaluationRuns = sqliteTable("evaluation_runs", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), suiteId: text("suite_id").notNull().references(() => benchmarkSuites.id), workflowVersionId: text("workflow_version_id").references(() => researchWorkflowVersions.id), skillVersionId: text("skill_version_id").references(() => researchSkillVersions.id), status: text("status", { enum: ["queued", "running", "succeeded", "failed"] }).notNull(), scoresJson: text("scores_json"), explanationsJson: text("explanations_json"), sampleCount: integer("sample_count").notNull().default(0), passedCount: integer("passed_count").notNull().default(0), modelVersion: text("model_version"), promptVersion: text("prompt_version"), asOf: text("as_of").notNull(), startedAt: text("started_at"), completedAt: text("completed_at"), ...timestamps,
}, (t) => [index("evaluation_runs_suite_idx").on(t.suiteId, t.createdAt)]);

export const apiClients = sqliteTable("api_clients", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), name: text("name").notNull(), keyPrefix: text("key_prefix").notNull(), secretHash: text("secret_hash").notNull(), scopesJson: text("scopes_json").notNull(), createdByUserId: text("created_by_user_id").notNull().references(() => users.id), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), expiresAt: text("expires_at"), lastUsedAt: text("last_used_at"), revokedAt: text("revoked_at"), ...timestamps,
}, (t) => [uniqueIndex("api_clients_secret_hash_uq").on(t.secretHash), index("api_clients_workspace_idx").on(t.workspaceId, t.enabled)]);

export const webhookSubscriptions = sqliteTable("webhook_subscriptions", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), name: text("name").notNull(), endpointUrl: text("endpoint_url").notNull(), eventTypesJson: text("event_types_json").notNull(), secretCiphertext: text("secret_ciphertext").notNull(), secretIv: text("secret_iv").notNull(), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), verificationStatus: text("verification_status", { enum: ["pending", "verified", "failing", "disabled"] }).notNull().default("pending"), consecutiveFailures: integer("consecutive_failures").notNull().default(0), lastDeliveryAt: text("last_delivery_at"), ...timestamps,
}, (t) => [index("webhook_subscriptions_workspace_idx").on(t.workspaceId, t.enabled)]);

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(), workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }), subscriptionId: text("subscription_id").notNull().references(() => webhookSubscriptions.id, { onDelete: "cascade" }), eventId: text("event_id").notNull(), eventType: text("event_type").notNull(), payloadJson: text("payload_json").notNull(), status: text("status", { enum: ["queued", "sending", "delivered", "failed", "dead_letter", "cancelled"] }).notNull(), attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(5), nextAttemptAt: text("next_attempt_at").notNull(), leaseOwner: text("lease_owner"), leaseToken: text("lease_token"), leaseExpiresAt: text("lease_expires_at"), idempotencyKey: text("idempotency_key"), responseStatus: integer("response_status"), responseBytes: integer("response_bytes"), responseHash: text("response_hash"), deliveredAt: text("delivered_at"), deadLetteredAt: text("dead_lettered_at"), errorCode: text("error_code"), errorMessage: text("error_message"), ...timestamps,
}, (t) => [uniqueIndex("webhook_deliveries_event_uq").on(t.subscriptionId, t.eventId), index("webhook_deliveries_queue_idx").on(t.status, t.nextAttemptAt)]);
