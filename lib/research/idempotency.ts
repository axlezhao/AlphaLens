export async function researchIdempotencyKey(input: {
  ticker: string;
  question: string;
  asOfDate: string;
}): Promise<string> {
  const canonical = JSON.stringify({
    ticker: input.ticker.trim().toUpperCase(),
    question: input.question.trim(),
    asOfDate: input.asOfDate,
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical)),
  );
  const hash = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `research-v1-${hash}`;
}
