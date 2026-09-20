/**
 * Webhook destination safety. A webhook target is an untrusted URL supplied by
 * a workspace owner, so delivery must refuse targets that reach internal
 * infrastructure (SSRF). This module provides a pure, testable URL validator:
 * no network I/O, no DNS resolution side effects — it inspects the URL string
 * and classifies the host as safe, loopback/private/link-local/metadata, or
 * otherwise unsafe.
 */

export type WebhookUrlDecision = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOSTNAME_EXACT = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata.google.internal",
  "metadata",
]);

const BLOCKED_HOSTNAME_SUFFIX = [".local", ".internal", ".localhost", ".arpa"];

function isPrivateIpv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local (includes cloud metadata 169.254.169.254)
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 127) return true; // loopback
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isUnsafeIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  // loopback, link-local, unique-local, unspecified, IPv4-mapped loopback
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.includes("::ffff:127.")) return true;
  return false;
}

/**
 * Decides whether a webhook URL is safe to fetch.
 * @param raw the URL supplied by the workspace owner
 * @param allowLoopback only true in an explicit local development context
 */
export function validateWebhookUrl(raw: string, allowLoopback = false): WebhookUrlDecision {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }

  if (url.protocol !== "https:" && !(allowLoopback && url.protocol === "http:")) {
    return { ok: false, reason: "UNSAFE_SCHEME" };
  }

  const hostname = url.hostname.toLowerCase();
  // Strip IPv6 brackets for classification.
  const bare = hostname.replace(/^\[|\]$/g, "");

  if (bare.includes(":")) {
    if (isUnsafeIpv6(bare)) return { ok: false, reason: "UNSAFE_HOST" };
    return { ok: true, url };
  }

  // IPv4 literal
  const parts = bare.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const octets = parts.map(Number);
    if (octets.every((o) => o >= 0 && o <= 255)) {
      if (isPrivateIpv4(octets)) {
        if (allowLoopback && octets[0] === 127) return { ok: true, url };
        return { ok: false, reason: "UNSAFE_HOST" };
      }
      return { ok: true, url };
    }
  }

  // Hostname-based blocks (DNS rebinding defence at the literal level).
  if (BLOCKED_HOSTNAME_EXACT.has(bare)) {
    if (allowLoopback && bare === "localhost") return { ok: true, url };
    return { ok: false, reason: "UNSAFE_HOST" };
  }
  if (BLOCKED_HOSTNAME_SUFFIX.some((suffix) => bare.endsWith(suffix))) {
    return { ok: false, reason: "UNSAFE_HOST" };
  }

  return { ok: true, url };
}

/**
 * Returns a bounded, credential-free summary of a delivery failure. Never
 * includes the signing secret, Authorization header, request body or the raw
 * response body.
 */
export function summarizeDeliveryError(error: unknown, limit = 500): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(secret|token|authorization|bearer|password|api[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bbearer\s+\S+/gi, "[redacted]")
    .replace(/\b(secret|token|authorization|bearer|password|api[_-]?key)\b/gi, "[redacted]")
    .slice(0, limit);
}
