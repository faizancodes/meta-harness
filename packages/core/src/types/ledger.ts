import type { ProviderId } from "./adapter.js";
import type { RunMode } from "./events.js";

export interface SessionLedger {
  schemaVersion: "metaharness.session-ledger.v1";
  ledgerId: string;
  createdAt: string;
  updatedAt: string;
  task: {
    originalPrompt: string;
    normalizedPrompt?: string;
    mode: RunMode;
    desiredOutput?: "message" | "patch" | "branch" | "pull_request";
  };
  provider: {
    id: ProviderId;
    model?: string;
    runtime?: "local" | "cloud" | "self-hosted";
    nativeSessionId?: string;
    nativeRunId?: string;
    nativeUrl?: string;
  };
  workspace: {
    cwd: string;
    repo?: {
      remoteUrl?: string;
      baseRef?: string;
      headRef?: string;
      startingCommit?: string;
      endingCommit?: string;
      branch?: string;
    };
    dirtyBefore: boolean;
    dirtyAfter: boolean;
  };
  events: {
    eventLogPath: string;
    rawEventLogPath?: string;
    counts: Record<string, number>;
  };
  transcript: Array<{
    role: "user" | "assistant" | "tool" | "system";
    text?: string;
    summary?: string;
    providerEventRef?: string;
    ts: string;
  }>;
  plans: Array<{
    ts: string;
    steps: Array<{
      step: string;
      status: string;
    }>;
  }>;
  tools: Array<{
    ts: string;
    name: string;
    kind: string;
    inputSummary?: string;
    outputSummary?: string;
  }>;
  commands: Array<{
    ts: string;
    command: string;
    cwd?: string;
    exitCode?: number;
    outputSummary?: string;
  }>;
  files: {
    read: string[];
    changed: Array<{
      path: string;
      kind: "create" | "modify" | "delete" | "rename" | "unknown";
      diff?: string;
    }>;
  };
  verification: Array<{
    command: string;
    exitCode?: number;
    outputPath?: string;
    summary?: string;
  }>;
  artifacts: Array<{
    kind: "patch" | "branch" | "pull_request" | "file" | "url" | "unknown";
    path?: string;
    url?: string;
    name?: string;
  }>;
  diff: {
    patchPath?: string;
    unifiedDiff?: string;
    stats?: {
      filesChanged: number;
      insertions?: number;
      deletions?: number;
    };
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
  summary: {
    finalMessage?: string;
    facts: string[];
    openQuestions: string[];
    nextSteps: string[];
    failureReason?: string;
  };
  handoffFrom?: {
    ledgerId: string;
    provider: ProviderId;
    runId: string;
  };
}
