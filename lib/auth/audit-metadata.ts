const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key|credential|prompt(?:[_-]|$)|raw(?:[_-]|$)|body(?:[_-]|$)|content(?:[_-]|$))/i;
const MAX_DEPTH = 4;
const MAX_ITEMS = 32;
const MAX_STRING_LENGTH = 512;

/**
 * Audit metadata is useful for operational traceability, but it is not a second
 * application log. Keep it bounded and exclude values that may contain secrets
 * or user-provided research content.
 */
export function sanitizeAuditMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  const value = sanitizeValue(metadata, 0, new WeakSet<object>());
  return isRecord(value) ? value : {};
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => sanitizeValue(item, depth + 1, seen)).filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return undefined;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, MAX_ITEMS)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const result = sanitizeValue(nested, depth + 1, seen);
    if (result !== undefined) sanitized[key] = result;
  }
  seen.delete(value);
  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
