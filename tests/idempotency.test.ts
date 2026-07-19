import test from "node:test";
import assert from "node:assert/strict";
import { researchIdempotencyKey } from "../lib/research/idempotency.ts";

test("Chinese research questions produce a deterministic ASCII header value", async () => {
  const input = {
    ticker: "nvda",
    question: "NVDA 还会增长吗？",
    asOfDate: "2026-07-19",
  };
  const first = await researchIdempotencyKey(input);
  const second = await researchIdempotencyKey(input);
  assert.equal(first, second);
  assert.match(first, /^research-v1-[a-f0-9]{64}$/);
  assert.match(first, /^[\x20-\x7e]+$/);
});

test("materially different questions do not share an idempotency key", async () => {
  const base = { ticker: "NVDA", asOfDate: "2026-07-19" };
  const growth = await researchIdempotencyKey({ ...base, question: "增长是否可持续？" });
  const valuation = await researchIdempotencyKey({ ...base, question: "估值是否合理？" });
  assert.notEqual(growth, valuation);
});
