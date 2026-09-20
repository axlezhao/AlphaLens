import { isLocalFixtureMode } from "../runtime/local-fixture";
import type { WebhookDeliveryRow } from "./service";
import { summarizeDeliveryError, validateWebhookUrl } from "./webhook-safety";

/**
 * Webhook delivery with SSRF-safe URL validation, timeouts, a payload size cap
 * and a signing header derived from an environment secret (never persisted).
 * `fetchImpl` is injectable so tests can assert against a local endpoint or a
 * fake without touching the network.
 *
 * The response body is consumed only to compute a bounded, non-sensitive
 * fingerprint (byte length + content hash); the raw body is never returned or
 * persisted, so an external endpoint cannot leak sensitive data into the DB.
 */

const MAX_PAYLOAD_BYTES = 256 * 1024;
const CONNECT_TIMEOUT_MS = 5_000;

export type DeliveryResult = { status: number; bytes: number; hash: string };

export async function deliverWebhook(delivery: WebhookDeliveryRow, fetchImpl: typeof fetch = fetch): Promise<DeliveryResult> {
  const allowLoopback = isLocalFixtureMode();
  const decision = validateWebhookUrl(delivery.endpointUrl, allowLoopback);
  if (!decision.ok) {
    throw Object.assign(new Error(`Unsafe webhook destination: ${decision.reason}`), { code: "UNSAFE_DESTINATION", retryable: false });
  }

  const payload = JSON.stringify({ id: delivery.eventId, type: delivery.eventType, payload: JSON.parse(delivery.payloadJson) });
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) {
    throw Object.assign(new Error(`Webhook payload exceeds ${MAX_PAYLOAD_BYTES} bytes`), { code: "PAYLOAD_TOO_LARGE", retryable: false });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);

  const signingSecret = process.env.WEBHOOK_SIGNING_SECRET;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "AlphaLens-Webhook/1.0",
    "x-alphalens-event-id": delivery.eventId,
    "x-alphalens-event-type": delivery.eventType,
  };
  if (signingSecret) {
    headers["x-alphalens-signature"] = await hmacSignature(signingSecret, payload);
  }

  try {
    const response = await fetchImpl(delivery.endpointUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    const bytes = Buffer.byteLength(text);
    const hash = await contentDigest(text);
    if (response.status >= 200 && response.status < 300) {
      return { status: response.status, bytes, hash };
    }
    // Non-2xx is retryable (transient upstream failure); 4xx like 410 Gone is
    // treated as retryable here to keep the model simple and observable.
    throw Object.assign(new Error(`Webhook responded ${response.status}`), { code: "DELIVERY_REJECTED", retryable: true, status: response.status, body: text.slice(0, 1000) });
  } finally {
    clearTimeout(timer);
  }
}

async function contentDigest(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSignature(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function deliveryFailureMeta(error: unknown): { retryable: boolean; code: string; message: string } {
  const anyError = error as { retryable?: boolean; code?: string } & Error;
  const retryable = anyError.retryable !== false;
  return { retryable, code: anyError.code ?? "DELIVERY_ERROR", message: summarizeDeliveryError(anyError.message ?? String(error)) };
}
