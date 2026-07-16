import type { ResearchJob } from "./contracts";

export interface ResearchProvider {
  start(input: { ticker: string; question: string; asOf?: string }): Promise<ResearchJob>;
}

export class DemoResearchProvider implements ResearchProvider {
  async start(input: { ticker: string; question: string; asOf?: string }): Promise<ResearchJob> {
    const now = new Date().toISOString();
    return {
      id: `demo_${crypto.randomUUID()}`,
      ticker: input.ticker.toUpperCase(),
      question: input.question,
      status: "queued",
      asOf: input.asOf ?? now,
      traceId: crypto.randomUUID(),
    };
  }
}
