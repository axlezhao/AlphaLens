export type EvidenceKind = "FACT" | "EXPECTATION" | "INFERENCE" | "USER_VIEW" | "UNVERIFIED";

export interface SourceRef {
  id: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string;
  accessedAt: string;
  authority: "primary" | "market" | "media" | "user";
}

export interface EvidenceItem {
  id: string;
  securityId: string;
  kind: EvidenceKind;
  claim: string;
  excerpt?: string;
  sourceIds: string[];
  confidence: number;
  observedAt: string;
  expiresAt?: string;
  supportsThesis: boolean | null;
}

export interface Thesis {
  id: string;
  securityId: string;
  statement: string;
  status: "draft" | "active" | "weakening" | "invalidated" | "closed";
  conviction: number;
  evidenceIds: string[];
  falsifiers: Array<{ metric: string; operator: "lt" | "lte" | "gt" | "gte"; threshold: number; periods: number }>;
  createdAt: string;
  reviewedAt: string;
  version: number;
}

export interface ResearchJob {
  id: string;
  ticker: string;
  question: string;
  status: "queued" | "running" | "succeeded" | "failed";
  asOf: string;
  traceId: string;
}
