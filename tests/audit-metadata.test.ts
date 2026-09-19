import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeAuditMetadata } from "../lib/auth/audit-metadata.ts";

test("audit metadata keeps operational fields but excludes secrets and raw research content", () => {
  const result = sanitizeAuditMetadata({
    ticker: "NVDA",
    asOf: "2026-09-19T00:00:00.000Z",
    apiKey: "must-not-be-stored",
    authorization: "Bearer must-not-be-stored",
    prompt: "user research question",
    source: { url: "https://www.sec.gov/Archives/example", content: "full filing text" },
  });
  assert.deepEqual(result, { ticker: "NVDA", asOf: "2026-09-19T00:00:00.000Z", source: { url: "https://www.sec.gov/Archives/example" } });
});

test("audit metadata is bounded and serializable", () => {
  const circular: Record<string, unknown> = { note: "x".repeat(700) };
  circular.self = circular;
  const result = sanitizeAuditMetadata({ circular, values: Array.from({ length: 40 }, (_, index) => index) });
  assert.equal(String((result.circular as Record<string, unknown>).note).length, 512);
  assert.equal((result.circular as Record<string, unknown>).self, "[circular]");
  assert.equal((result.values as unknown[]).length, 32);
  assert.doesNotThrow(() => JSON.stringify(result));
});
