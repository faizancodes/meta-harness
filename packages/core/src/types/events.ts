import type { ProviderId } from "./adapter.js";
import type { RunResult } from "./result.js";

export type PortableRunEvent =
  | RunStartedEvent
  | RunStatusEvent
  | AssistantMessageDeltaEvent
  | AssistantMessageCompletedEvent
  | PlanUpdatedEvent
  | ToolStartedEvent
  | ToolDeltaEvent
  | ToolFinishedEvent
  | CommandStartedEvent
  | CommandOutputDeltaEvent
  | CommandFinishedEvent
  | FileChangeStartedEvent
  | FileChangeUpdatedEvent
  | FileChangeFinishedEvent
  | DiffUpdatedEvent
  | ApprovalRequestedEvent
  | ApprovalResolvedEvent
  | UsageUpdatedEvent
  | ArtifactCreatedEvent
  | ErrorEvent
  | RunCompletedEvent
  | RawProviderEvent;

export type PortableRunEventType = PortableRunEvent["type"];

export const portableRunEventTypes = [
  "run.started",
  "run.status",
  "assistant.message.delta",
  "assistant.message.completed",
  "plan.updated",
  "tool.started",
  "tool.delta",
  "tool.finished",
  "command.started",
  "command.output.delta",
  "command.finished",
  "file.change.started",
  "file.change.updated",
  "file.change.finished",
  "diff.updated",
  "approval.requested",
  "approval.resolved",
  "usage.updated",
  "artifact.created",
  "error",
  "run.completed",
  "provider.raw"
] as const satisfies readonly PortableRunEventType[];

export interface BaseEvent {
  id: string;
  ts: string;
  provider: ProviderId;
  runId: string;
  sessionId: string;
  seq: number;
  severity?: "debug" | "info" | "warn" | "error";
}

export interface RunStartedEvent extends BaseEvent {
  type: "run.started";
  input: {
    taskHash: string;
    mode: RunMode;
    cwd?: string;
  };
}

export interface RunStatusEvent extends BaseEvent {
  type: "run.status";
  status:
    | "queued"
    | "starting"
    | "running"
    | "waiting_for_approval"
    | "cancelling"
    | "completed"
    | "failed"
    | "cancelled";
  message?: string;
}

export interface AssistantMessageDeltaEvent extends BaseEvent {
  type: "assistant.message.delta";
  text: string;
  phase?: "commentary" | "final" | "unknown";
}

export interface AssistantMessageCompletedEvent extends BaseEvent {
  type: "assistant.message.completed";
  text: string;
  phase?: "commentary" | "final" | "unknown";
}

export interface PlanUpdatedEvent extends BaseEvent {
  type: "plan.updated";
  explanation?: string;
  steps: Array<{
    step: string;
    status: "pending" | "in_progress" | "completed" | "cancelled" | "failed";
  }>;
}

export interface ToolStartedEvent extends BaseEvent {
  type: "tool.started";
  tool: ToolIdentity;
  input?: unknown;
}

export interface ToolDeltaEvent extends BaseEvent {
  type: "tool.delta";
  toolCallId?: string;
  text?: string;
  data?: unknown;
}

export interface ToolFinishedEvent extends BaseEvent {
  type: "tool.finished";
  tool: ToolIdentity;
  output?: unknown;
  error?: NormalizedError;
}

export interface CommandStartedEvent extends BaseEvent {
  type: "command.started";
  command: string;
  cwd?: string;
  reason?: string;
}

export interface CommandOutputDeltaEvent extends BaseEvent {
  type: "command.output.delta";
  commandId?: string;
  stream: "stdout" | "stderr" | "combined" | "unknown";
  text: string;
}

export interface CommandFinishedEvent extends BaseEvent {
  type: "command.finished";
  command: string;
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
  outputSummary?: string;
  error?: NormalizedError;
}

export interface FileChangeStartedEvent extends BaseEvent {
  type: "file.change.started";
  path: string;
  changeKind: FileChangeKind;
}

export interface FileChangeUpdatedEvent extends BaseEvent {
  type: "file.change.updated";
  path: string;
  diff?: string;
}

export interface FileChangeFinishedEvent extends BaseEvent {
  type: "file.change.finished";
  path: string;
  changeKind: FileChangeKind;
  diff?: string;
  status: "completed" | "failed" | "declined";
}

export interface DiffUpdatedEvent extends BaseEvent {
  type: "diff.updated";
  unifiedDiff: string;
}

export interface ApprovalRequestedEvent extends BaseEvent {
  type: "approval.requested";
  approvalId: string;
  category:
    | "command"
    | "file_change"
    | "network"
    | "mcp_tool"
    | "provider_native"
    | "unknown";
  reason?: string;
  preview?: {
    command?: string;
    cwd?: string;
    path?: string;
    diff?: string;
    host?: string;
    protocol?: string;
  };
  availableDecisions: Array<"accept" | "accept_for_session" | "decline" | "cancel">;
  native?: unknown;
}

export interface ApprovalResolvedEvent extends BaseEvent {
  type: "approval.resolved";
  approvalId: string;
  decision: "accept" | "accept_for_session" | "decline" | "cancel";
}

export interface UsageUpdatedEvent extends BaseEvent {
  type: "usage.updated";
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
  };
}

export interface ArtifactCreatedEvent extends BaseEvent {
  type: "artifact.created";
  artifact: {
    kind: "patch" | "branch" | "pull_request" | "file" | "screenshot" | "url" | "unknown";
    name?: string;
    path?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
}

export interface ErrorEvent extends BaseEvent {
  type: "error";
  error: NormalizedError;
}

export interface RunCompletedEvent extends BaseEvent {
  type: "run.completed";
  status: "success" | "failed" | "cancelled";
  finalMessage?: string;
  result?: Partial<RunResult>;
}

export interface RawProviderEvent extends BaseEvent {
  type: "provider.raw";
  providerEventType?: string;
  raw: unknown;
}

export interface NormalizedError {
  message: string;
  code?: string;
  providerCode?: string;
  retryable?: boolean;
  cause?: unknown;
}

export interface ToolIdentity {
  name: string;
  kind: "mcp" | "built_in" | "dynamic" | "provider_native" | "unknown";
  server?: string;
}

export type FileChangeKind = "create" | "modify" | "delete" | "rename" | "unknown";

export type RunMode = "ask" | "edit" | "review" | "plan" | "custom";
