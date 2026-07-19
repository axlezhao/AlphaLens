import { getD1 } from "../../db";

type ChannelRow = { id: string; channelType: "email" | "wecom_webhook" | "wechat_official"; secretCiphertext: string | null; secretIv: string | null };

export async function encryptConnectorSecret(value: string) {
  const key = await connectorKey(); const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
  return { ciphertext: base64(new Uint8Array(encrypted)), iv: base64(iv) };
}

export async function decryptConnectorSecret(ciphertext: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(iv) }, await connectorKey(), fromBase64(ciphertext));
  return new TextDecoder().decode(decrypted);
}

export async function drainNotificationOutbox(limit = 10) {
  const db = getD1(); const now = new Date().toISOString(); const results: Array<{ id: string; status: string }> = [];
  const rows = await db.prepare("SELECT o.id,o.title,o.body,o.event_key AS eventKey,o.attempts,c.id AS channelId,c.channel_type AS channelType,c.secret_ciphertext AS secretCiphertext,c.secret_iv AS secretIv FROM notification_outbox o JOIN notification_channels c ON c.id=o.channel_id WHERE o.status IN ('queued','failed') AND o.next_attempt_at<=? AND o.attempts<5 AND c.enabled=1 ORDER BY o.created_at LIMIT ?").bind(now, Math.min(limit, 25)).all<Record<string, unknown>>();
  for (const raw of rows.results) {
    const row = raw as unknown as ChannelRow & { title: string; body: string; eventKey: string; attempts: number };
    const claimed = await db.prepare("UPDATE notification_outbox SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('queued','failed')").bind(now, row.id).run();
    if (!claimed.meta.changes) continue;
    try {
      if (!row.secretCiphertext || !row.secretIv) throw new Error("Connector destination is missing");
      const destination = await decryptConnectorSecret(row.secretCiphertext, row.secretIv);
      const providerMessageId = await send(row.channelType, destination, row.title, row.body, row.eventKey);
      const completedAt = new Date().toISOString();
      await db.prepare("UPDATE notification_outbox SET status='delivered',provider_message_id=?,delivered_at=?,error_message=NULL,updated_at=? WHERE id=?").bind(providerMessageId, completedAt, completedAt, row.id).run();
      results.push({ id: row.id, status: "delivered" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const next = new Date(Date.now() + 60_000 * 2 ** Math.min(row.attempts, 5)).toISOString();
      await db.prepare("UPDATE notification_outbox SET status='failed',next_attempt_at=?,error_message=?,updated_at=? WHERE id=?").bind(next, message.slice(0, 1000), new Date().toISOString(), row.id).run();
      results.push({ id: row.id, status: "failed" });
    }
  }
  return results;
}

async function send(type: ChannelRow["channelType"], destination: string, title: string, body: string, eventKey: string) {
  if (type === "email") {
    const apiKey = process.env.RESEND_API_KEY; const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) throw new Error("Email connector is not configured");
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": eventKey.slice(0, 256) }, body: JSON.stringify({ from, to: [destination], subject: title, text: body }) });
    const payload = await response.json() as { id?: string; message?: string };
    if (!response.ok) throw new Error(`Resend ${response.status}: ${payload.message ?? "send failed"}`);
    return payload.id ?? eventKey;
  }
  if (type === "wecom_webhook") {
    const url = new URL(destination);
    if (url.protocol !== "https:" || url.hostname !== "qyapi.weixin.qq.com") throw new Error("WeCom webhook must use the official qyapi.weixin.qq.com HTTPS endpoint");
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ msgtype: "markdown", markdown: { content: `**${title}**\n>${body}` } }) });
    const payload = await response.json() as { errcode?: number; errmsg?: string };
    if (!response.ok || payload.errcode) throw new Error(`WeCom ${payload.errcode ?? response.status}: ${payload.errmsg ?? "send failed"}`);
    return eventKey;
  }
  const endpoint = process.env.WECHAT_OFFICIAL_SEND_URL; const token = process.env.WECHAT_OFFICIAL_ACCESS_TOKEN;
  if (!endpoint || !token) throw new Error("WeChat Official Account connector is not configured or authorized");
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ touser: destination, msgtype: "text", text: { content: `${title}\n${body}` } }) });
  const payload = await response.json() as { errcode?: number; errmsg?: string; msgid?: string };
  if (!response.ok || payload.errcode) throw new Error(`WeChat ${payload.errcode ?? response.status}: ${payload.errmsg ?? "send failed"}`);
  return payload.msgid ?? eventKey;
}

async function connectorKey() {
  const secret = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!secret || secret.length < 16) throw new Error("CONNECTOR_ENCRYPTION_KEY must be configured with at least 16 characters");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
function base64(value: Uint8Array) { return btoa(String.fromCharCode(...value)); }
function fromBase64(value: string) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
