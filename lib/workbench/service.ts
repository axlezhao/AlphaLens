import { getD1 } from "../../db";
import type { AuthContext } from "../auth/context";
import { HttpError } from "../auth/context";
import { contentHash, stableId } from "../core/ids";
import { issuerIrEvents } from "../providers/issuer-ir";
import { saveSource } from "../research/evidence-repository";
import { enqueueResearch } from "../research/queue";
import { cognitiveBiasStats } from "./analytics";
import { encryptConnectorSecret } from "./connectors";
import type { ReportModel } from "./exports";

type JsonRecord = Record<string, unknown>;

export async function getWorkbench(context: AuthContext, ticker?: string) {
  await ensureDefaults(context);
  const db = getD1(); const selected = ticker ? await findSecurity(context.workspaceId, ticker) : null;
  const watchlists = await db.prepare("SELECT id,name,description,is_default AS isDefault,created_at AS createdAt,updated_at AS updatedAt FROM watchlists WHERE workspace_id=? ORDER BY is_default DESC,updated_at DESC").bind(context.workspaceId).all<JsonRecord>();
  const items = await db.prepare("SELECT wi.watchlist_id AS watchlistId,wi.priority,wi.notes,wi.added_at AS addedAt,s.id AS securityId,s.ticker,s.issuer_name AS issuerName FROM watchlist_items wi JOIN watchlists w ON w.id=wi.watchlist_id JOIN securities s ON s.id=wi.security_id WHERE w.workspace_id=? ORDER BY wi.priority DESC,wi.added_at").bind(context.workspaceId).all<JsonRecord>();
  const timeline = selected ? await db.prepare("SELECT id,logical_id AS logicalId,version,statement,status,conviction,falsifiers_json AS falsifiersJson,as_of AS asOf,reviewed_at AS reviewedAt,created_at AS createdAt FROM theses WHERE workspace_id=? AND security_id=? ORDER BY logical_id,version DESC").bind(context.workspaceId, selected.id).all<JsonRecord>() : { results: [] };
  const thesisLogicalId = timeline.results[0]?.logicalId as string | undefined;
  const falsifiers = thesisLogicalId ? await db.prepare("SELECT f.id,f.logical_id AS logicalId,f.version,f.label,f.metric,f.operator,f.threshold,f.unit,f.evaluation_window AS evaluationWindow,f.status,f.current_value AS currentValue,f.note,f.as_of AS asOf FROM thesis_falsifiers f WHERE f.workspace_id=? AND f.thesis_logical_id=? AND f.version=(SELECT MAX(x.version) FROM thesis_falsifiers x WHERE x.logical_id=f.logical_id) ORDER BY f.created_at").bind(context.workspaceId, thesisLogicalId).all<JsonRecord>() : { results: [] };
  const earnings = await db.prepare("SELECT ew.id,ew.workflow_type AS workflowType,ew.fiscal_period AS fiscalPeriod,ew.event_at AS eventAt,ew.status,ew.research_job_id AS researchJobId,ew.expectations_json AS expectationsJson,ew.output_json AS outputJson,ew.as_of AS asOf,s.ticker FROM earnings_workflows ew JOIN securities s ON s.id=ew.security_id WHERE ew.workspace_id=? ORDER BY COALESCE(ew.event_at,ew.created_at) DESC LIMIT 50").bind(context.workspaceId).all<JsonRecord>();
  const catalysts = await db.prepare("SELECT c.id,c.title,c.event_type AS eventType,c.event_at AS eventAt,c.date_status AS dateStatus,c.status,c.as_of AS asOf,s.ticker,src.canonical_url AS sourceUrl,src.is_stale AS isStale FROM catalysts c JOIN securities s ON s.id=c.security_id LEFT JOIN sources src ON src.id=c.source_id WHERE c.workspace_id=? ORDER BY CASE WHEN c.event_at IS NULL THEN 1 ELSE 0 END,c.event_at LIMIT 100").bind(context.workspaceId).all<JsonRecord>();
  const subscriptions = await db.prepare("SELECT cs.id,cs.enabled,cs.refresh_interval_minutes AS refreshIntervalMinutes,cs.last_refresh_at AS lastRefreshAt,cs.next_refresh_at AS nextRefreshAt,cs.last_status AS lastStatus,cs.last_error AS lastError,s.ticker FROM catalyst_subscriptions cs JOIN securities s ON s.id=cs.security_id WHERE cs.workspace_id=? ORDER BY s.ticker").bind(context.workspaceId).all<JsonRecord>();
  const channels = await db.prepare("SELECT id,channel_type AS channelType,label,destination_hint AS destinationHint,enabled,verification_status AS verificationStatus,created_at AS createdAt,updated_at AS updatedAt FROM notification_channels WHERE workspace_id=? AND user_id=? ORDER BY created_at").bind(context.workspaceId, context.userId).all<JsonRecord>();
  const groups = selected ? await db.prepare("SELECT id,name,metric_keys_json AS metricKeysJson FROM peer_groups WHERE workspace_id=? AND anchor_security_id=? ORDER BY updated_at DESC").bind(context.workspaceId, selected.id).all<JsonRecord>() : { results: [] };
  const groupId = groups.results[0]?.id as string | undefined;
  const peers = groupId ? await db.prepare("SELECT s.id AS securityId,s.ticker,s.issuer_name AS issuerName,pgm.metrics_json AS metricsJson,pgm.metrics_as_of AS metricsAsOf,src.canonical_url AS sourceUrl,src.is_stale AS isStale FROM peer_group_members pgm JOIN securities s ON s.id=pgm.security_id LEFT JOIN sources src ON src.id=pgm.source_id WHERE pgm.peer_group_id=? ORDER BY pgm.sort_order,s.ticker").bind(groupId).all<JsonRecord>() : { results: [] };
  const reviews = await db.prepare("SELECT r.id,r.review_type AS reviewType,r.decision,r.confidence,r.expected_outcome AS expectedOutcome,r.actual_outcome AS actualOutcome,r.outcome_score AS outcomeScore,r.biases_json AS biasesJson,r.lessons,r.next_action AS nextAction,r.as_of AS asOf,r.created_at AS createdAt,s.ticker FROM investment_reviews r JOIN securities s ON s.id=r.security_id WHERE r.workspace_id=? AND r.user_id=? ORDER BY r.created_at DESC LIMIT 100").bind(context.workspaceId, context.userId).all<JsonRecord>();
  const parsedReviews = reviews.results.map(parseJsonColumns);
  return {
    selectedSecurity: selected,
    watchlists: watchlists.results.map((watchlist) => ({ ...watchlist, items: items.results.filter((item) => item.watchlistId === watchlist.id) })),
    thesisTimeline: timeline.results.map(parseJsonColumns), falsifiers: falsifiers.results,
    earnings: earnings.results.map(parseJsonColumns), catalysts: catalysts.results, catalystSubscriptions: subscriptions.results,
    notificationChannels: channels.results,
    peerGroup: groups.results[0] ? parseJsonColumns(groups.results[0]) : null, peers: peers.results.map(parseJsonColumns),
    reviews: parsedReviews,
    biasStats: cognitiveBiasStats(parsedReviews.map((review) => ({ biases: asStringArray(review.biases), confidence: Number(review.confidence), outcomeScore: review.outcomeScore == null ? null : Number(review.outcomeScore) }))),
    capabilityStatus: { email: Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL), wecomWebhook: true, wechatOfficial: Boolean(process.env.WECHAT_OFFICIAL_SEND_URL && process.env.WECHAT_OFFICIAL_ACCESS_TOKEN) },
    asOf: new Date().toISOString(),
  };
}

export async function mutateWorkbench(context: AuthContext, input: JsonRecord) {
  const action = requiredString(input.action, "action"); const now = new Date().toISOString(); const db = getD1();
  await ensureDefaults(context);
  if (action === "watchlist.create") {
    const name = requiredString(input.name, "name", 80); const id = await stableId("wli", `${context.workspaceId}:${context.userId}:${name}:${crypto.randomUUID()}`);
    await db.prepare("INSERT INTO watchlists (id,workspace_id,owner_user_id,name,description,is_default,created_at,updated_at) VALUES (?,?,?,?,?,0,?,?)").bind(id, context.workspaceId, context.userId, name, optionalString(input.description, 300), now, now).run();
    return { id, action };
  }
  if (action === "watchlist.add") {
    const watchlistId = requiredString(input.watchlistId, "watchlistId"); await assertWatchlist(context.workspaceId, watchlistId); const security = await ensureSecurity(context.workspaceId, requiredTicker(input.ticker), optionalString(input.issuerName, 120));
    await db.batch([
      db.prepare("INSERT OR REPLACE INTO watchlist_items (watchlist_id,security_id,added_by_user_id,priority,notes,added_at) VALUES (?,?,?,?,?,?)").bind(watchlistId, security.id, context.userId, integer(input.priority, 0, 5, 0), optionalString(input.notes, 500), now),
      db.prepare("INSERT OR IGNORE INTO catalyst_subscriptions (id,workspace_id,security_id,enabled,refresh_interval_minutes,next_refresh_at,last_status,created_at,updated_at) VALUES (?,?,?,1,360,?,'never',?,?)").bind(await stableId("cas", `${context.workspaceId}:${security.id}`), context.workspaceId, security.id, now, now, now),
    ]);
    return { action, security };
  }
  if (action === "watchlist.remove") {
    const watchlistId = requiredString(input.watchlistId, "watchlistId"); await assertWatchlist(context.workspaceId, watchlistId); const security = await findSecurity(context.workspaceId, requiredTicker(input.ticker));
    if (security) await db.prepare("DELETE FROM watchlist_items WHERE watchlist_id=? AND security_id=?").bind(watchlistId, security.id).run();
    return { action };
  }
  if (action === "thesis.save") {
    const security = await ensureSecurity(context.workspaceId, requiredTicker(input.ticker)); const logicalId = optionalString(input.logicalId) ?? await stableId("thl", `${context.workspaceId}:${security.id}:primary`);
    const previous = await db.prepare("SELECT id,version FROM theses WHERE workspace_id=? AND logical_id=? ORDER BY version DESC LIMIT 1").bind(context.workspaceId, logicalId).first<{ id: string; version: number }>(); const version = (previous?.version ?? 0) + 1; const id = await stableId("ths", `${logicalId}:${version}`);
    const falsifiers = Array.isArray(input.falsifiers) ? input.falsifiers : [];
    await db.prepare("INSERT INTO theses (id,logical_id,version,workspace_id,security_id,statement,status,conviction,falsifiers_json,supersedes_id,as_of,reviewed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, logicalId, version, context.workspaceId, security.id, requiredString(input.statement, "statement", 4000), enumValue(input.status, ["draft","active","weakening","invalidated","closed"], "active"), decimal(input.conviction, 0, 1, 0.5), JSON.stringify(falsifiers), previous?.id ?? null, validDate(input.asOf) ?? now, now, now, now).run();
    for (const raw of falsifiers) await saveFalsifier(context, logicalId, raw as JsonRecord, now);
    return { action, id, logicalId, version };
  }
  if (action === "falsifier.save") return { action, ...(await saveFalsifier(context, requiredString(input.thesisLogicalId, "thesisLogicalId"), input, now)) };
  if (action === "earnings.create") {
    const ticker = requiredTicker(input.ticker); const type = enumValue(input.workflowType, ["preview", "deep_dive"], "preview"); const period = requiredString(input.fiscalPeriod, "fiscalPeriod", 40); const asOf = validDate(input.asOf) ?? now;
    const expectations = isRecord(input.expectations) ? input.expectations : {}; const key = await contentHash({ workspaceId: context.workspaceId, ticker, type, period, asOf: asOf.slice(0, 10) });
    const job = await enqueueResearch(context, { ticker, asOf, idempotencyKey: `earnings:${key}`, question: type === "preview" ? `为 ${ticker} ${period} 财报建立 Preview：一致预期、关键 KPI、分歧、情景与证伪条件` : `对 ${ticker} ${period} 财报执行 Deep Dive：逐项对比预期与实际、电话会变化、论点影响与下一催化剂` });
    const security = await findSecurity(context.workspaceId, ticker); const id = await stableId("ern", `${context.workspaceId}:${key}`);
    await db.prepare("INSERT OR IGNORE INTO earnings_workflows (id,workspace_id,security_id,requested_by_user_id,workflow_type,fiscal_period,event_at,status,research_job_id,expectations_json,as_of,idempotency_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, context.workspaceId, security!.id, context.userId, type, period, validDate(input.eventAt), job?.status ?? "queued", job?.id, JSON.stringify(expectations), asOf, key, now, now).run();
    return { action, id, researchJobId: job?.id, status: job?.status ?? "queued" };
  }
  if (action === "catalyst.refresh") return refreshCatalysts(context, requiredTicker(input.ticker));
  if (action === "catalyst.save") {
    const security = await ensureSecurity(context.workspaceId, requiredTicker(input.ticker)); const title = requiredString(input.title, "title", 240); const eventAt = validDate(input.eventAt); const id = await stableId("cat", `${context.workspaceId}:${security.id}:${title}:${eventAt ?? "unknown"}`);
    await db.prepare("INSERT INTO catalysts (id,workspace_id,security_id,title,event_type,event_at,date_status,status,as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET event_at=excluded.event_at,date_status=excluded.date_status,status=excluded.status,as_of=excluded.as_of,updated_at=excluded.updated_at").bind(id, context.workspaceId, security.id, title, optionalString(input.eventType, 80) ?? "user_event", eventAt, enumValue(input.dateStatus, ["confirmed","estimated","unknown"], eventAt ? "estimated" : "unknown"), enumValue(input.status, ["upcoming","occurred","cancelled"], "upcoming"), now, now, now).run();
    return { action, id };
  }
  if (action === "notification.channel.save") {
    const type = enumValue(input.channelType, ["email", "wecom_webhook", "wechat_official"], "email"); const destination = requiredString(input.destination, "destination", 1000); validateDestination(type, destination); const encrypted = await encryptConnectorSecret(destination); const id = await stableId("nch", `${context.workspaceId}:${context.userId}:${type}:${await contentHash(destination)}`);
    const ruleId = await stableId("nrl", `${context.workspaceId}:${context.userId}:${id}:default`);
    await db.batch([
      db.prepare("INSERT INTO notification_channels (id,workspace_id,user_id,channel_type,label,destination_hint,secret_ciphertext,secret_iv,enabled,verification_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,1,'unverified',?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,destination_hint=excluded.destination_hint,secret_ciphertext=excluded.secret_ciphertext,secret_iv=excluded.secret_iv,enabled=1,updated_at=excluded.updated_at").bind(id, context.workspaceId, context.userId, type, optionalString(input.label, 80) ?? channelLabel(type), maskDestination(type, destination), encrypted.ciphertext, encrypted.iv, now, now),
      db.prepare("INSERT OR IGNORE INTO notification_rules (id,workspace_id,user_id,channel_id,security_id,event_types_json,lead_minutes,enabled,created_at,updated_at) VALUES (?,?,?,?,NULL,?,1440,1,?,?)").bind(ruleId, context.workspaceId, context.userId, id, JSON.stringify(["catalyst", "thesis_changed", "falsifier_triggered", "earnings"]), now, now),
    ]);
    return { action, id, channelType: type };
  }
  if (action === "notification.rule.save") {
    const channelId = requiredString(input.channelId, "channelId"); await assertChannel(context, channelId); const ticker = optionalString(input.ticker); const security = ticker ? await ensureSecurity(context.workspaceId, requiredTicker(ticker)) : null; const events = asStringArray(input.eventTypes); if (!events.length) throw new HttpError(400, "INVALID_ARGUMENT", "至少选择一种提醒事件"); const id = await stableId("nrl", `${context.workspaceId}:${context.userId}:${channelId}:${security?.id ?? "all"}:${events.sort().join(",")}`);
    await db.prepare("INSERT INTO notification_rules (id,workspace_id,user_id,channel_id,security_id,event_types_json,lead_minutes,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET event_types_json=excluded.event_types_json,lead_minutes=excluded.lead_minutes,enabled=1,updated_at=excluded.updated_at").bind(id, context.workspaceId, context.userId, channelId, security?.id ?? null, JSON.stringify(events), integer(input.leadMinutes, 0, 10080, 1440), now, now).run();
    return { action, id };
  }
  if (action === "notification.test") {
    const channelId = requiredString(input.channelId, "channelId"); await assertChannel(context, channelId); const eventKey = `test:${channelId}:${now.slice(0, 16)}`; const id = await stableId("nout", eventKey);
    await db.prepare("INSERT OR IGNORE INTO notification_outbox (id,workspace_id,channel_id,event_key,title,body,payload_json,status,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'{}','queued',0,?,?,?)").bind(id, context.workspaceId, channelId, eventKey, "AlphaLens 提醒通道测试", "通道连接成功后，你会在这里收到论点、证伪条件和催化剂提醒。", now, now, now).run();
    return { action, id, status: "queued" };
  }
  if (action === "peers.save") {
    const anchor = await ensureSecurity(context.workspaceId, requiredTicker(input.ticker)); const name = optionalString(input.name, 80) ?? `${anchor.ticker} 同行组`; const id = optionalString(input.peerGroupId) ?? await stableId("pgr", `${context.workspaceId}:${anchor.id}:${name}`); const metrics = asStringArray(input.metricKeys); const members = Array.isArray(input.members) ? input.members : [];
    await db.prepare("INSERT INTO peer_groups (id,workspace_id,anchor_security_id,name,metric_keys_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,metric_keys_json=excluded.metric_keys_json,updated_at=excluded.updated_at").bind(id, context.workspaceId, anchor.id, name, JSON.stringify(metrics), now, now).run();
    for (let index = 0; index < members.length; index++) { const member = members[index] as JsonRecord; const security = await ensureSecurity(context.workspaceId, requiredTicker(member.ticker), optionalString(member.issuerName, 120)); await db.prepare("INSERT INTO peer_group_members (peer_group_id,security_id,sort_order,metrics_json,metrics_as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(peer_group_id,security_id) DO UPDATE SET sort_order=excluded.sort_order,metrics_json=excluded.metrics_json,metrics_as_of=excluded.metrics_as_of,updated_at=excluded.updated_at").bind(id, security.id, index, JSON.stringify(isRecord(member.metrics) ? member.metrics : {}), validDate(member.asOf) ?? now, now, now).run(); }
    return { action, id, members: members.length };
  }
  if (action === "review.create") {
    const security = await ensureSecurity(context.workspaceId, requiredTicker(input.ticker)); const id = crypto.randomUUID(); const biases = asStringArray(input.biases);
    await db.prepare("INSERT INTO investment_reviews (id,workspace_id,user_id,security_id,template_id,thesis_logical_id,review_type,decision,confidence,expected_outcome,actual_outcome,outcome_score,biases_json,lessons,next_action,as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, context.workspaceId, context.userId, security.id, optionalString(input.templateId), optionalString(input.thesisLogicalId), enumValue(input.reviewType, ["decision","earnings","position","closed_trade"], "decision"), requiredString(input.decision, "decision", 2000), decimal(input.confidence, 0, 1, 0.5), optionalString(input.expectedOutcome, 2000), optionalString(input.actualOutcome, 2000), input.outcomeScore == null ? null : decimal(input.outcomeScore, -1, 1, 0), JSON.stringify(biases), optionalString(input.lessons, 4000), optionalString(input.nextAction, 2000), validDate(input.asOf) ?? now, now, now).run();
    return { action, id };
  }
  throw new HttpError(400, "UNKNOWN_ACTION", `不支持的工作台操作：${action}`);
}

async function ensureDefaults(context: AuthContext) {
  const now = new Date().toISOString(); const watchlistId = await stableId("wli", `${context.workspaceId}:${context.userId}:default`); const templateId = await stableId("rvt", `${context.workspaceId}:${context.userId}:default`);
  await getD1().batch([
    getD1().prepare("INSERT OR IGNORE INTO watchlists (id,workspace_id,owner_user_id,name,description,is_default,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)").bind(watchlistId, context.workspaceId, context.userId, "核心观察池", "需要持续验证的公司", now, now),
    getD1().prepare("INSERT OR IGNORE INTO review_templates (id,workspace_id,owner_user_id,name,schema_json,is_default,created_at,updated_at) VALUES (?,?,?,?,?,1,?,?)").bind(templateId, context.workspaceId, context.userId, "标准投资复盘", JSON.stringify({ sections: ["当时知道什么", "预期与事实差异", "论点如何变化", "哪些偏差影响判断", "下一步规则"] }), now, now),
  ]);
}

async function saveFalsifier(context: AuthContext, thesisLogicalId: string, input: JsonRecord, now: string) {
  const logicalId = optionalString(input.logicalId) ?? await stableId("fal", `${context.workspaceId}:${thesisLogicalId}:${requiredString(input.label, "label", 500)}`); const previous = await getD1().prepare("SELECT id,version FROM thesis_falsifiers WHERE workspace_id=? AND logical_id=? ORDER BY version DESC LIMIT 1").bind(context.workspaceId, logicalId).first<{ id: string; version: number }>(); const version = (previous?.version ?? 0) + 1; const id = await stableId("fav", `${logicalId}:${version}`);
  await getD1().prepare("INSERT INTO thesis_falsifiers (id,logical_id,version,workspace_id,thesis_logical_id,label,metric,operator,threshold,unit,evaluation_window,status,current_value,note,supersedes_id,as_of,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, logicalId, version, context.workspaceId, thesisLogicalId, requiredString(input.label, "label", 500), optionalString(input.metric, 120), enumValue(input.operator, ["lt","lte","gt","gte","eq","manual"], "manual"), input.threshold == null ? null : decimal(input.threshold, -1e15, 1e15, 0), optionalString(input.unit, 40), optionalString(input.evaluationWindow, 120), enumValue(input.status, ["untriggered","warning","triggered","retired"], "untriggered"), input.currentValue == null ? null : decimal(input.currentValue, -1e15, 1e15, 0), optionalString(input.note, 1000), previous?.id ?? null, validDate(input.asOf) ?? now, now, now).run();
  return { id, logicalId, version };
}

export async function refreshCatalysts(context: AuthContext, ticker: string) {
  const db = getD1(); const security = await findSecurity(context.workspaceId, ticker); if (!security) throw new HttpError(404, "SECURITY_NOT_FOUND", "证券不在当前 Workspace"); const now = new Date().toISOString();
  if (!security.irBaseUrl || !security.irFeedUrl) {
    await db.prepare("UPDATE catalyst_subscriptions SET last_refresh_at=?,next_refresh_at=?,last_status='degraded',last_error='Issuer IR feed is not configured',updated_at=? WHERE workspace_id=? AND security_id=?").bind(now, new Date(Date.now() + 6 * 3600_000).toISOString(), now, context.workspaceId, security.id).run();
    return { action: "catalyst.refresh", ticker, status: "degraded", added: 0, reason: "尚未配置公司官方 IR Feed；不会使用未授权聚合源替代" };
  }
  try {
    const envelope = await issuerIrEvents(security.irFeedUrl, security.irBaseUrl); const sourceId = await saveSource(context.workspaceId, envelope, `${ticker} investor relations event feed`, `${ticker} Investor Relations`, "ir"); let added = 0;
    for (const event of envelope.data) { const eventAt = event.eventAt ?? event.publishedAt ?? null; const id = await stableId("cat", `${context.workspaceId}:${security.id}:${event.url}`); const result = await db.prepare("INSERT OR IGNORE INTO catalysts (id,workspace_id,security_id,source_id,title,event_type,event_at,date_status,status,as_of,created_at,updated_at) VALUES (?,?,?,?,?,'ir_event',?,?,'upcoming',?,?,?)").bind(id, context.workspaceId, security.id, sourceId, event.title, eventAt, event.eventAt ? "confirmed" : eventAt ? "estimated" : "unknown", envelope.asOf, now, now).run(); added += result.meta.changes ?? 0; }
    await db.prepare("UPDATE catalyst_subscriptions SET last_refresh_at=?,next_refresh_at=?,last_status='healthy',last_error=NULL,updated_at=? WHERE workspace_id=? AND security_id=?").bind(now, new Date(Date.now() + 6 * 3600_000).toISOString(), now, context.workspaceId, security.id).run();
    return { action: "catalyst.refresh", ticker, status: envelope.freshness, added, asOf: envelope.asOf };
  } catch (error) { const message = error instanceof Error ? error.message : String(error); await db.prepare("UPDATE catalyst_subscriptions SET last_refresh_at=?,next_refresh_at=?,last_status='failed',last_error=?,updated_at=? WHERE workspace_id=? AND security_id=?").bind(now, new Date(Date.now() + 30 * 60_000).toISOString(), message.slice(0, 1000), now, context.workspaceId, security.id).run(); throw error; }
}

export async function refreshDueCatalysts(limit = 10) {
  const due = await getD1().prepare("SELECT cs.workspace_id AS workspaceId,s.ticker FROM catalyst_subscriptions cs JOIN securities s ON s.id=cs.security_id WHERE cs.enabled=1 AND cs.next_refresh_at<=? ORDER BY cs.next_refresh_at LIMIT ?").bind(new Date().toISOString(), Math.min(limit, 25)).all<{ workspaceId: string; ticker: string }>();
  const results: Array<{ ticker: string; status: string }> = [];
  for (const item of due.results) {
    try { const result = await refreshCatalysts({ workspaceId: item.workspaceId, userId: "system", email: "system@alphalens.local", role: "owner" }, item.ticker); results.push({ ticker: item.ticker, status: String(result.status) }); }
    catch { results.push({ ticker: item.ticker, status: "failed" }); }
  }
  await getD1().prepare("UPDATE earnings_workflows SET status=(SELECT status FROM research_jobs WHERE research_jobs.id=earnings_workflows.research_job_id),output_json=(SELECT snapshot_json FROM research_jobs WHERE research_jobs.id=earnings_workflows.research_job_id),updated_at=? WHERE research_job_id IS NOT NULL AND EXISTS (SELECT 1 FROM research_jobs WHERE research_jobs.id=earnings_workflows.research_job_id AND research_jobs.status<>earnings_workflows.status)").bind(new Date().toISOString()).run();
  return results;
}

export async function queueDueCatalystNotifications() {
  const db = getD1(); const now = new Date(); const rules = await db.prepare("SELECT r.id,r.workspace_id AS workspaceId,r.channel_id AS channelId,r.security_id AS securityId,r.event_types_json AS eventTypesJson,r.lead_minutes AS leadMinutes FROM notification_rules r JOIN notification_channels c ON c.id=r.channel_id WHERE r.enabled=1 AND c.enabled=1").all<{ id: string; workspaceId: string; channelId: string; securityId: string | null; eventTypesJson: string; leadMinutes: number }>(); let queued = 0;
  for (const rule of rules.results) {
    if (!asStringArray(safeArray(rule.eventTypesJson)).includes("catalyst")) continue;
    const until = new Date(now.getTime() + rule.leadMinutes * 60_000).toISOString(); const events = await db.prepare("SELECT c.id,c.title,c.event_at AS eventAt,s.ticker FROM catalysts c JOIN securities s ON s.id=c.security_id WHERE c.workspace_id=? AND c.status='upcoming' AND c.event_at>? AND c.event_at<=? AND (? IS NULL OR c.security_id=?)").bind(rule.workspaceId, now.toISOString(), until, rule.securityId, rule.securityId).all<{ id: string; title: string; eventAt: string; ticker: string }>();
    for (const event of events.results) { const eventKey = `catalyst:${event.id}:${event.eventAt}:${rule.leadMinutes}`; const id = await stableId("nout", `${rule.channelId}:${eventKey}`); const result = await db.prepare("INSERT OR IGNORE INTO notification_outbox (id,workspace_id,channel_id,event_key,title,body,payload_json,status,attempts,next_attempt_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'queued',0,?,?,?)").bind(id, rule.workspaceId, rule.channelId, eventKey, `${event.ticker} 催化剂提醒`, `${event.title}\n事件时间：${event.eventAt}\n请回到 AlphaLens 核验论点和证伪条件。`, JSON.stringify({ catalystId: event.id, ticker: event.ticker, eventAt: event.eventAt }), now.toISOString(), now.toISOString(), now.toISOString()).run(); queued += result.meta.changes ?? 0; }
  }
  return queued;
}

export async function buildReport(context: AuthContext, ticker: string): Promise<ReportModel> {
  const security = await findSecurity(context.workspaceId, ticker); if (!security) throw new HttpError(404, "SECURITY_NOT_FOUND", "证券不在当前 Workspace"); const db = getD1();
  const thesis = await db.prepare("SELECT logical_id AS logicalId,version,statement,status,conviction,as_of AS asOf FROM theses WHERE workspace_id=? AND security_id=? ORDER BY version DESC LIMIT 1").bind(context.workspaceId, security.id).first<JsonRecord>();
  const falsifiers = thesis ? await db.prepare("SELECT f.label,f.status,f.threshold,f.unit FROM thesis_falsifiers f WHERE f.workspace_id=? AND f.thesis_logical_id=? AND f.version=(SELECT MAX(x.version) FROM thesis_falsifiers x WHERE x.logical_id=f.logical_id) ORDER BY f.created_at").bind(context.workspaceId, thesis.logicalId).all<{ label: string; status: string; threshold: number | null; unit: string | null }>() : { results: [] };
  const catalysts = await db.prepare("SELECT title,event_at AS eventAt,date_status AS dateStatus,status FROM catalysts WHERE workspace_id=? AND security_id=? ORDER BY event_at LIMIT 100").bind(context.workspaceId, security.id).all<{ title: string; eventAt: string | null; dateStatus: string; status: string }>();
  const evidence = await db.prepare("SELECT e.kind,e.claim,e.as_of AS asOf,e.confidence,src.title AS source,src.is_stale AS isStale FROM evidence e JOIN sources src ON src.id=e.source_id WHERE e.workspace_id=? AND e.security_id=? AND e.version=(SELECT MAX(x.version) FROM evidence x WHERE x.logical_id=e.logical_id) ORDER BY e.as_of DESC LIMIT 200").bind(context.workspaceId, security.id).all<{ kind: string; claim: string; asOf: string; confidence: number; source: string; isStale: boolean }>();
  const group = await db.prepare("SELECT id FROM peer_groups WHERE workspace_id=? AND anchor_security_id=? ORDER BY updated_at DESC LIMIT 1").bind(context.workspaceId, security.id).first<{ id: string }>();
  const peers = group ? await db.prepare("SELECT s.ticker,pgm.metrics_json AS metricsJson,pgm.metrics_as_of AS asOf,src.is_stale AS isStale FROM peer_group_members pgm JOIN securities s ON s.id=pgm.security_id LEFT JOIN sources src ON src.id=pgm.source_id WHERE pgm.peer_group_id=? ORDER BY pgm.sort_order").bind(group.id).all<{ ticker: string; metricsJson: string; asOf: string | null; isStale: boolean | null }>() : { results: [] };
  const warnings = [
    evidence.results.some((item) => item.isStale) ? "证据台账包含已标记为陈旧的来源。" : null,
    peers.results.some((item) => !item.asOf) ? "部分同行指标缺少 as_of，不应直接用于估值结论。" : null,
    !process.env.ALPHA_VANTAGE_API_KEY ? "授权行情/一致预期 Provider 尚未配置；报告不会把演示数字标记为实时数据。" : null,
  ].filter((item): item is string => Boolean(item));
  return { ticker: security.ticker, issuerName: security.issuerName, asOf: new Date().toISOString(), thesis: thesis ? { statement: String(thesis.statement), status: String(thesis.status), conviction: Number(thesis.conviction), version: Number(thesis.version) } : null, falsifiers: falsifiers.results, catalysts: catalysts.results, evidence: evidence.results, peers: peers.results.map((peer) => ({ ticker: peer.ticker, metrics: safeObject(peer.metricsJson), asOf: peer.asOf })), warnings };
}

async function ensureSecurity(workspaceId: string, ticker: string, issuerName?: string | null) { const now = new Date().toISOString(); const id = await stableId("sec", `${workspaceId}:US:${ticker}`); await getD1().prepare("INSERT INTO securities (id,workspace_id,ticker,exchange,issuer_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(workspace_id,ticker,exchange) DO UPDATE SET issuer_name=COALESCE(excluded.issuer_name,securities.issuer_name),updated_at=excluded.updated_at").bind(id, workspaceId, ticker, "US", issuerName ?? null, now, now).run(); return (await findSecurity(workspaceId, ticker))!; }
async function findSecurity(workspaceId: string, ticker: string) { return getD1().prepare("SELECT id,ticker,issuer_name AS issuerName,ir_base_url AS irBaseUrl,ir_feed_url AS irFeedUrl FROM securities WHERE workspace_id=? AND ticker=? AND exchange='US'").bind(workspaceId, ticker.toUpperCase()).first<{ id: string; ticker: string; issuerName: string | null; irBaseUrl: string | null; irFeedUrl: string | null }>(); }
async function assertWatchlist(workspaceId: string, id: string) { if (!await getD1().prepare("SELECT id FROM watchlists WHERE id=? AND workspace_id=?").bind(id, workspaceId).first()) throw new HttpError(404, "WATCHLIST_NOT_FOUND", "观察池不存在"); }
async function assertChannel(context: AuthContext, id: string) { if (!await getD1().prepare("SELECT id FROM notification_channels WHERE id=? AND workspace_id=? AND user_id=?").bind(id, context.workspaceId, context.userId).first()) throw new HttpError(404, "CHANNEL_NOT_FOUND", "提醒通道不存在"); }
function parseJsonColumns(value: JsonRecord) { const result = { ...value }; for (const key of ["falsifiersJson","expectationsJson","outputJson","metricKeysJson","metricsJson","biasesJson"]) if (typeof result[key] === "string") { try { result[key.replace(/Json$/, "")] = JSON.parse(result[key] as string); } catch { result[key.replace(/Json$/, "")] = null; } delete result[key]; } return result; }
function requiredTicker(value: unknown) { const ticker = requiredString(value, "ticker", 10).toUpperCase(); if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)) throw new HttpError(400, "INVALID_TICKER", "美股代码格式不正确"); return ticker; }
function requiredString(value: unknown, name: string, max = 200) { if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new HttpError(400, "INVALID_ARGUMENT", `${name} 格式不正确`); return value.trim(); }
function optionalString(value: unknown, max = 200) { return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null; }
function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T { return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback; }
function integer(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : fallback; }
function decimal(value: unknown, min: number, max: number, fallback: number) { const number = Number(value); return Number.isFinite(number) && number >= min && number <= max ? number : fallback; }
function validDate(value: unknown) { return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null; }
function isRecord(value: unknown): value is JsonRecord { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function asStringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 30) : []; }
function channelLabel(type: string) { return type === "email" ? "研究邮件" : type === "wecom_webhook" ? "企业微信群机器人" : "微信公众号"; }
function maskDestination(type: string, destination: string) { if (type === "email") { const [name, domain] = destination.split("@"); return `${name.slice(0, 2)}***@${domain}`; } if (type === "wecom_webhook") return "qyapi.weixin.qq.com/***"; return `${destination.slice(0, 4)}***${destination.slice(-4)}`; }
function validateDestination(type: string, destination: string) { if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) throw new HttpError(400, "INVALID_EMAIL", "邮箱格式不正确"); if (type === "wecom_webhook") { try { const url = new URL(destination); if (url.protocol !== "https:" || url.hostname !== "qyapi.weixin.qq.com") throw new Error(); } catch { throw new HttpError(400, "INVALID_WECOM_WEBHOOK", "仅支持企业微信官方 HTTPS Webhook"); } } }
function safeObject(value: string) { try { const parsed = JSON.parse(value); return isRecord(parsed) ? parsed as Record<string, number | string | null> : {}; } catch { return {}; } }
function safeArray(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
