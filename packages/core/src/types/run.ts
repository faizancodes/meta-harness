import type { ProviderId } from "./adapter.js";
import type { RunMode } from "./events.js";
import type { HarnessPolicyConfig } from "./policy.js";
import type { WorkspaceConfig } from "./workspace.js";

export interface RunInput {
  task: string;
  mode?: RunMode;
  provider?: ProviderId;
  model?: string;
  runtime?: "local" | "cloud" | "self-hosted";
  workspace?: Partial<WorkspaceConfig>;
  policy?: HarnessPolicyConfig;
  limits?: RunLimits;
  desiredOutput?: "message" | "patch" | "branch" | "pull_request";
  metadata?: Record<string, unknown>;
  native?: Record<string, unknown>;
  rawEvents?: boolean;
  verification?: string[];
}

export interface RunLimits {
  maxTurns?: number;
  maxDurationMs?: number;
  maxCostUsd?: number;
  maxFilesChanged?: number;
  maxDiffBytes?: number;
}

export interface RunHandle<TNative = unknown> {
  provider: ProviderId;
  runId: string;
  sessionId: string;
  nativeRunId?: string;
  nativeSessionId?: string;
  native: TNative;
  startedAt: string;
}
