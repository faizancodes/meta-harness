import type { ProviderId } from "./adapter.js";

export interface Artifact {
  kind: "patch" | "branch" | "pull_request" | "file" | "screenshot" | "url" | "unknown";
  name?: string;
  path?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface RunResult {
  provider: ProviderId;
  runId: string;
  sessionId: string;
  nativeRunId?: string;
  nativeSessionId?: string;
  status: "success" | "failed" | "cancelled";
  finalMessage?: string;
  diff?: string;
  patchPath?: string;
  ledgerPath?: string;
  handoffPath?: string;
  eventLogPath?: string;
  verificationLogPath?: string;
  artifacts: Artifact[];
  usage?: Usage;
  providerRunUrl?: string;
  native?: unknown;
}
