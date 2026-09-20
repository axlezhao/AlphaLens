/**
 * ResearchJob state machine. A single source of truth for status values,
 * terminal states, claimable states and the classification of retryable vs
 * non-retryable failures. Kept separate from the queue/runner so both the
 * worker and any future API surface share the same transitions.
 */

export const JOB_STATUSES = ["queued", "running", "retrying", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Terminal states are never re-executed or overwritten. */
export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(["succeeded", "failed", "cancelled"]);

/** States a worker may atomically claim for execution. */
export const CLAIMABLE_JOB_STATUSES: ReadonlySet<JobStatus> = new Set(["queued", "retrying"]);

export function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.has(status as JobStatus);
}

export function isClaimableJobStatus(status: string): boolean {
  return CLAIMABLE_JOB_STATUSES.has(status as JobStatus);
}

/**
 * A failure that should never be retried (authorization, permanent config
 * errors, malformed inputs that a retry cannot fix). Anything else thrown by a
 * provider call is treated as retryable.
 */
export class NonRetryableJobError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "NonRetryableJobError";
  }
}

/**
 * Classifies a thrown error. Non-retryable errors fail immediately; everything
 * else is eligible for bounded retry with exponential backoff.
 */
export function classifyJobError(error: unknown): { retryable: boolean; code: string; message: string } {
  if (error instanceof NonRetryableJobError) {
    return { retryable: false, code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { retryable: true, code: "RETRYABLE", message };
}

/** Exponential backoff with jitter-free deterministic delay (test-friendly). */
export function backoffDelayMs(attempt: number): number {
  return 1000 * 2 ** Math.max(0, attempt - 1);
}

/** Cap error summaries so a persistent error cannot balloon the row. */
export function summarizeError(message: string, limit = 1000): string {
  return message.slice(0, limit);
}
