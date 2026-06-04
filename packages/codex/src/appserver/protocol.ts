import type { CodexApprovalPolicy, CodexSandboxMode, CodexTurnLike } from "../types.js";
import type { PortableRunEvent, RunInput, RunResult } from "@metaharness/core";

export type CodexAppServerMode = "app-server";
export type CodexAppServerJsonRpcId = string | number;

export interface CodexAppServerClientConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  requestTimeoutMs: number;
}

export interface CodexAppServerClientLike {
  close(): Promise<void>;
  events(): AsyncIterable<CodexAppServerInboundMessage>;
  initialize(params: CodexAppServerInitializeParams): Promise<unknown>;
  interruptTurn(threadId: string, turnId: string): Promise<unknown>;
  respond(id: CodexAppServerJsonRpcId, result: unknown): Promise<void>;
  respondError?(
    id: CodexAppServerJsonRpcId,
    error: CodexAppServerErrorLike
  ): Promise<void>;
  resumeThread(
    params: CodexAppServerThreadResumeParamsLike
  ): Promise<CodexAppServerThreadResponseLike>;
  startThread(
    params: CodexAppServerThreadStartParamsLike
  ): Promise<CodexAppServerThreadResponseLike>;
  startTurn(
    params: CodexAppServerTurnStartParamsLike
  ): Promise<CodexAppServerTurnResponseLike>;
}

export type CodexAppServerClientFactory = (
  config: CodexAppServerClientConfig
) => Promise<CodexAppServerClientLike> | CodexAppServerClientLike;

export type CodexAppServerInboundMessage =
  | CodexAppServerNotificationLike
  | CodexAppServerRequestLike;

export interface CodexAppServerInitializeParams {
  clientInfo: {
    name: string;
    title: string;
    version: string;
  };
}

export interface CodexAppServerNotificationLike {
  method: string;
  params?: unknown;
}

export interface CodexAppServerRequestLike {
  id: CodexAppServerJsonRpcId;
  method: string;
  params?: unknown;
}

export type CodexAppServerApprovalDecision = Extract<
  PortableRunEvent,
  { type: "approval.resolved" }
>["decision"];

export type CodexAppServerApprovalRequestEvent = Extract<
  PortableRunEvent,
  { type: "approval.requested" }
>;

export interface CodexAppServerApprovalContext {
  approval: CodexAppServerApprovalRequestEvent;
  request: CodexAppServerRequestLike;
}

export interface CodexAppServerRequestResolution {
  decision: CodexAppServerApprovalDecision;
  error?: CodexAppServerErrorLike;
  result?: unknown;
}

export type CodexAppServerApprovalResolver = (
  context: CodexAppServerApprovalContext
) => Promise<CodexAppServerRequestResolution> | CodexAppServerRequestResolution;

export interface CodexAppServerResponseLike {
  error?: CodexAppServerErrorLike;
  id: CodexAppServerJsonRpcId;
  result?: unknown;
}

export interface CodexAppServerErrorLike {
  code?: number | string;
  message: string;
  data?: unknown;
}

export interface CodexAppServerThreadStartParamsLike {
  approvalPolicy?: CodexApprovalPolicy | CodexAppServerGranularApprovalPolicy | null;
  approvalsReviewer?: unknown;
  baseInstructions?: string | null;
  config?: Record<string, unknown> | null;
  cwd?: string | null;
  developerInstructions?: string | null;
  ephemeral?: boolean | null;
  experimentalRawEvents: boolean;
  model?: string | null;
  modelProvider?: string | null;
  permissionProfile?: unknown;
  persistExtendedHistory: boolean;
  personality?: string | null;
  sandbox?: CodexSandboxMode | null;
  serviceName?: string | null;
  serviceTier?: string | null;
  sessionStartSource?: unknown;
}

export interface CodexAppServerThreadResumeParamsLike extends CodexAppServerThreadStartParamsLike {
  excludeTurns?: boolean;
  history?: unknown[] | null;
  path?: string | null;
  threadId: string;
}

export interface CodexAppServerGranularApprovalPolicy {
  granular: {
    mcp_elicitations: boolean;
    request_permissions: boolean;
    rules: boolean;
    sandbox_approval: boolean;
    skill_approval: boolean;
  };
}

export interface CodexAppServerThreadResponseLike {
  cwd?: string;
  model?: string;
  modelProvider?: string;
  thread?: CodexAppServerThreadLike;
  [key: string]: unknown;
}

export interface CodexAppServerThreadLike {
  id?: string;
  cwd?: string;
  turns?: CodexAppServerTurnLike[];
  [key: string]: unknown;
}

export interface CodexAppServerTurnStartParamsLike {
  approvalPolicy?: CodexApprovalPolicy | CodexAppServerGranularApprovalPolicy | null;
  approvalsReviewer?: unknown;
  collaborationMode?: unknown;
  cwd?: string | null;
  effort?: "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  input: Array<
    | {
        text: string;
        type: "text";
      }
    | {
        path: string;
        type: "localImage";
      }
    | {
        type: "image";
        url: string;
      }
  >;
  model?: string | null;
  outputSchema?: unknown;
  permissionProfile?: unknown;
  personality?: string | null;
  sandboxPolicy?: unknown;
  serviceTier?: string | null;
  summary?: string | null;
  threadId: string;
}

export interface CodexAppServerTurnResponseLike {
  turn?: CodexAppServerTurnLike;
  [key: string]: unknown;
}

export interface CodexAppServerTurnLike {
  completedAt?: number | null;
  durationMs?: number | null;
  error?: {
    message?: string;
    [key: string]: unknown;
  } | null;
  id?: string;
  items?: CodexAppServerThreadItemLike[];
  startedAt?: number | null;
  status?: "completed" | "interrupted" | "failed" | "inProgress" | string;
  [key: string]: unknown;
}

export type CodexAppServerThreadItemLike =
  | CodexAppServerAgentMessageItemLike
  | CodexAppServerReasoningItemLike
  | CodexAppServerPlanItemLike
  | CodexAppServerCommandExecutionItemLike
  | CodexAppServerFileChangeItemLike
  | CodexAppServerMcpToolCallItemLike
  | CodexAppServerDynamicToolCallItemLike
  | CodexAppServerWebSearchItemLike
  | {
      id?: string;
      type: string;
      [key: string]: unknown;
    };

export interface CodexAppServerAgentMessageItemLike {
  id: string;
  memoryCitation?: unknown;
  phase?: "commentary" | "final_answer" | string | null;
  text: string;
  type: "agentMessage";
}

export interface CodexAppServerReasoningItemLike {
  content?: string[];
  id: string;
  summary?: string[];
  type: "reasoning";
}

export interface CodexAppServerPlanItemLike {
  id: string;
  text: string;
  type: "plan";
}

export interface CodexAppServerCommandExecutionItemLike {
  aggregatedOutput?: string | null;
  command: string;
  cwd?: string | null;
  durationMs?: number | null;
  exitCode?: number | null;
  id: string;
  status: "inProgress" | "completed" | "failed" | "declined" | string;
  type: "commandExecution";
}

export interface CodexAppServerFileChangeItemLike {
  changes: CodexAppServerFileUpdateChangeLike[];
  id: string;
  status: "inProgress" | "completed" | "failed" | "declined" | string;
  type: "fileChange";
}

export interface CodexAppServerFileUpdateChangeLike {
  diff?: string;
  kind: "add" | "delete" | "update" | string;
  path: string;
}

export interface CodexAppServerMcpToolCallItemLike {
  arguments?: unknown;
  durationMs?: number | null;
  error?: {
    message?: string;
    [key: string]: unknown;
  } | null;
  id: string;
  result?: unknown;
  server: string;
  status: "inProgress" | "completed" | "failed" | string;
  tool: string;
  type: "mcpToolCall";
}

export interface CodexAppServerDynamicToolCallItemLike {
  arguments?: unknown;
  contentItems?: unknown[] | null;
  durationMs?: number | null;
  id: string;
  namespace?: string | null;
  status: "inProgress" | "completed" | "failed" | string;
  success?: boolean | null;
  tool: string;
  type: "dynamicToolCall";
}

export interface CodexAppServerWebSearchItemLike {
  action?: unknown;
  id: string;
  query?: string;
  type: "webSearch";
}

export interface CodexAppServerUsageBreakdownLike {
  cachedInputTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

export interface CodexAppServerThreadTokenUsageLike {
  last?: CodexAppServerUsageBreakdownLike;
  modelContextWindow?: number | null;
  total?: CodexAppServerUsageBreakdownLike;
}

export interface CodexAppServerNativeSession {
  client: CodexAppServerClientLike;
  clientConfig: CodexAppServerClientConfig;
  cwd: string;
  mode: CodexAppServerMode;
  thread: CodexAppServerThreadLike;
  threadOptions:
    | CodexAppServerThreadStartParamsLike
    | CodexAppServerThreadResumeParamsLike;
}

export interface CodexAppServerNativeRun {
  assistantTextByItem: Record<string, string>;
  client: CodexAppServerClientLike;
  completed: boolean;
  cwd: string;
  diff?: string;
  events: PortableRunEvent[];
  finalResult?: CodexTurnLike;
  finalTurn?: CodexAppServerTurnLike;
  input: RunInput;
  lastAssistantText?: string;
  mode: CodexAppServerMode;
  result?: Partial<RunResult>;
  seq: number;
  streamConsumed: boolean;
  threadId: string;
  turnId?: string;
  usage?: NonNullable<RunResult["usage"]>;
}

export function isAppServerRequest(
  message: CodexAppServerInboundMessage
): message is CodexAppServerRequestLike {
  return "id" in message && typeof message.method === "string";
}

export function isAppServerNotification(
  message: CodexAppServerInboundMessage
): message is CodexAppServerNotificationLike {
  return !("id" in message) && typeof message.method === "string";
}
