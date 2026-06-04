import type {
  PortableRunEvent,
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle
} from "@metaharness/core";

export interface CursorSdkModule {
  Agent: CursorAgentConstructorLike;
}

export interface CursorAgentConstructorLike {
  create(options: CursorAgentOptionsLike): Promise<CursorAgentLike> | CursorAgentLike;
  resume?(
    agentId: string,
    options?: Partial<CursorAgentOptionsLike>
  ): Promise<CursorAgentLike> | CursorAgentLike;
  getRun?(
    id: string,
    options?: CursorGetRunOptionsLike
  ): Promise<CursorRunLike> | CursorRunLike;
}

export type CursorSdkLoader = () => Promise<CursorSdkModule>;

export interface CursorAdapterOptions {
  loadSdk?: CursorSdkLoader;
}

export type CursorRuntime = "local" | "cloud" | "self-hosted";

export interface CursorAgentLike {
  readonly agentId?: string;
  readonly id?: string;
  readonly model?: CursorModelSelectionLike;
  close?: () => Promise<void> | void;
  listArtifacts?: () => Promise<CursorArtifactLike[]>;
  reload?: () => Promise<void>;
  send(
    message: string | CursorUserMessageLike,
    options?: CursorSendOptionsLike
  ): Promise<CursorRunLike> | CursorRunLike;
  [Symbol.asyncDispose]?: () => Promise<void>;
}

export interface CursorAgentOptionsLike {
  agentId?: string;
  agents?: Record<string, unknown>;
  apiKey?: string;
  cloud?: CursorCloudOptionsLike;
  idempotencyKey?: string;
  local?: CursorLocalOptionsLike;
  mcpServers?: Record<string, unknown>;
  mode?: "agent" | "plan" | string;
  model?: CursorModelSelectionLike;
  name?: string;
  [key: string]: unknown;
}

export interface CursorLocalOptionsLike {
  cwd?: string | string[];
  sandboxOptions?: {
    enabled: boolean;
  };
  settingSources?: string[];
  store?: unknown;
}

export interface CursorCloudOptionsLike {
  autoCreatePR?: boolean;
  env?: {
    name?: string;
    type: "cloud" | "pool" | "machine";
  };
  envVars?: Record<string, string>;
  repos?: Array<{
    prUrl?: string;
    startingRef?: string;
    url: string;
  }>;
  skipReviewerRequest?: boolean;
  workOnCurrentBranch?: boolean;
}

export interface CursorSendOptionsLike {
  idempotencyKey?: string;
  local?: {
    force?: boolean;
  };
  mcpServers?: Record<string, unknown>;
  mode?: "agent" | "plan" | string;
  model?: CursorModelSelectionLike;
  [key: string]: unknown;
}

export interface CursorGetRunOptionsLike {
  agentId?: string;
  apiKey?: string;
  cwd?: string;
  runtime?: "local" | "cloud";
  store?: unknown;
}

export interface CursorRunLike {
  readonly agentId?: string;
  readonly createdAt?: number;
  readonly durationMs?: number;
  readonly git?: CursorRunGitInfoLike;
  readonly id?: string;
  readonly model?: CursorModelSelectionLike;
  readonly result?: string;
  readonly status?: CursorRunStatusLike;
  cancel?: () => Promise<void>;
  conversation?: () => Promise<unknown[]>;
  onDidChangeStatus?: (listener: (status: CursorRunStatusLike) => void) => () => void;
  stream?: () => AsyncIterable<CursorSdkMessageLike>;
  supports?: (operation: CursorRunOperationLike) => boolean;
  unsupportedReason?: (operation: CursorRunOperationLike) => string | undefined;
  wait?: () => Promise<CursorRunResultLike>;
}

export type CursorRunStatusLike = "running" | "finished" | "error" | "cancelled" | string;

export type CursorRunResultStatusLike = "finished" | "error" | "cancelled" | string;
export type CursorRunOperationLike = "stream" | "wait" | "cancel" | "conversation";

export interface CursorRunGitInfoLike {
  branches?: Array<{
    branch?: string;
    prUrl?: string;
    repoUrl?: string;
  }>;
}

export interface CursorRunResultLike {
  durationMs?: number;
  git?: CursorRunGitInfoLike;
  id?: string;
  model?: CursorModelSelectionLike;
  result?: string;
  status?: CursorRunResultStatusLike;
}

export interface CursorModelSelectionLike {
  id?: string;
  params?: Array<{
    id: string;
    value: string;
  }>;
  [key: string]: unknown;
}

export interface CursorUserMessageLike {
  images?: unknown[];
  text: string;
}

export interface CursorArtifactLike {
  name?: string;
  path?: string;
  url?: string;
  [key: string]: unknown;
}

export type CursorSdkMessageLike =
  | CursorSystemMessageLike
  | CursorAssistantMessageLike
  | CursorUserMessageEventLike
  | CursorToolUseMessageLike
  | CursorThinkingMessageLike
  | CursorStatusMessageLike
  | CursorRequestMessageLike
  | CursorTaskMessageLike
  | {
      agent_id?: string;
      run_id?: string;
      type: string;
      [key: string]: unknown;
    };

export interface CursorSystemMessageLike {
  agent_id?: string;
  model?: CursorModelSelectionLike;
  run_id?: string;
  subtype?: "init" | string;
  tools?: string[];
  type: "system";
}

export interface CursorAssistantMessageLike {
  agent_id?: string;
  message?: {
    content?: CursorContentBlockLike[];
    role?: "assistant";
  };
  run_id?: string;
  type: "assistant";
}

export interface CursorUserMessageEventLike {
  agent_id?: string;
  message?: {
    content?: CursorContentBlockLike[];
    role?: "user";
  };
  run_id?: string;
  type: "user";
}

export interface CursorToolUseMessageLike {
  agent_id?: string;
  args?: unknown;
  call_id?: string;
  name?: string;
  result?: unknown;
  run_id?: string;
  status?: "running" | "completed" | "error" | string;
  truncated?: {
    args?: boolean;
    result?: boolean;
  };
  type: "tool_call";
}

export interface CursorThinkingMessageLike {
  agent_id?: string;
  run_id?: string;
  text?: string;
  thinking_duration_ms?: number;
  type: "thinking";
}

export interface CursorStatusMessageLike {
  agent_id?: string;
  message?: string;
  run_id?: string;
  status?:
    | "CREATING"
    | "RUNNING"
    | "FINISHED"
    | "ERROR"
    | "CANCELLED"
    | "EXPIRED"
    | string;
  type: "status";
}

export interface CursorRequestMessageLike {
  agent_id?: string;
  request_id?: string;
  run_id?: string;
  type: "request";
}

export interface CursorTaskMessageLike {
  agent_id?: string;
  run_id?: string;
  status?: string;
  text?: string;
  type: "task";
}

export type CursorContentBlockLike =
  | {
      text?: string;
      type: "text";
      [key: string]: unknown;
    }
  | {
      id?: string;
      input?: unknown;
      name?: string;
      type: "tool_use";
      [key: string]: unknown;
    }
  | {
      type?: string;
      [key: string]: unknown;
    };

export interface CursorNativeSession {
  agent: CursorAgentLike;
  agentId?: string;
  agentOptions: CursorAgentOptionsLike;
  cwd?: string;
  runtime: CursorRuntime;
}

export interface CursorNativeRun {
  agent: CursorAgentLike;
  agentId?: string;
  completed: boolean;
  cwd?: string;
  events: PortableRunEvent[];
  finalResult?: CursorRunResultLike;
  input: RunInput;
  run: CursorRunLike;
  runtime: CursorRuntime;
  seq: number;
  streamConsumed: boolean;
}

export type CursorSessionHandle = SessionHandle<CursorNativeSession>;
export type CursorRunHandle = RunHandle<CursorNativeRun>;
export type CursorMappedResult = RunResult;
