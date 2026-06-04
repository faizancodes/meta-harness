import type {
  PortableRunEvent,
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle
} from "@metaharness/core";

export interface ClaudeSdkModule {
  query(params: {
    options?: ClaudeOptionsLike;
    prompt: string | AsyncIterable<ClaudeSdkUserMessageLike>;
  }): ClaudeQueryLike;
}

export type ClaudeSdkLoader = () => Promise<ClaudeSdkModule>;

export interface ClaudeAdapterOptions {
  loadSdk?: ClaudeSdkLoader;
}

export type ClaudeQueryFunction = ClaudeSdkModule["query"];

export type ClaudeQueryLike = AsyncIterable<ClaudeSdkMessageLike> & {
  close?: () => void;
  stopTask?: (taskId: string) => Promise<void>;
};

export interface ClaudeOptionsLike {
  abortController?: AbortController;
  additionalDirectories?: string[];
  allowDangerouslySkipPermissions?: boolean;
  allowedTools?: string[];
  canUseTool?: ClaudeCanUseTool;
  cwd?: string;
  disallowedTools?: string[];
  enableFileCheckpointing?: boolean;
  env?: Record<string, string | undefined>;
  extraArgs?: Record<string, string | null>;
  fallbackModel?: string;
  forkSession?: boolean;
  hooks?: Record<string, unknown>;
  includeHookEvents?: boolean;
  includePartialMessages?: boolean;
  maxBudgetUsd?: number;
  maxTurns?: number;
  mcpServers?: Record<string, unknown>;
  model?: string;
  outputFormat?: unknown;
  pathToClaudeCodeExecutable?: string;
  permissionMode?: ClaudePermissionMode;
  permissionPromptToolName?: string;
  persistSession?: boolean;
  resume?: string;
  resumeSessionAt?: string;
  sandbox?: Record<string, unknown>;
  sessionId?: string;
  sessionStore?: unknown;
  settingSources?: string[];
  strictMcpConfig?: boolean;
  systemPrompt?: ClaudeSystemPromptLike;
  tools?: string[] | { preset: "claude_code"; type: "preset" };
  [key: string]: unknown;
}

export type ClaudePermissionMode =
  | "default"
  | "acceptEdits"
  | "bypassPermissions"
  | "plan"
  | "dontAsk"
  | "auto"
  | string;

export type ClaudeSystemPromptLike =
  | string
  | {
      append?: string;
      preset: "claude_code";
      type: "preset";
    };

export type ClaudeCanUseTool = (
  toolName: string,
  input: Record<string, unknown>,
  options: {
    agentID?: string;
    blockedPath?: string;
    decisionReason?: string;
    signal: AbortSignal;
    suggestions?: unknown[];
    toolUseID?: string;
    [key: string]: unknown;
  }
) => Promise<ClaudePermissionResult>;

export type ClaudePermissionResult =
  | {
      behavior: "allow";
      decisionClassification?: string;
      toolUseID?: string;
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: unknown[];
    }
  | {
      behavior: "deny";
      decisionClassification?: string;
      interrupt?: boolean;
      message: string;
      toolUseID?: string;
    };

export interface ClaudeSdkUserMessageLike {
  message: {
    content: unknown;
    role: "user";
  };
  parent_tool_use_id?: string | null;
  session_id?: string;
  type: "user";
  uuid?: string;
}

export type ClaudeSdkMessageLike =
  | ClaudeAssistantMessageLike
  | ClaudeUserMessageLike
  | ClaudeResultMessageLike
  | ClaudeSystemMessageLike
  | ClaudeStreamEventMessageLike
  | {
      session_id?: string;
      subtype?: string;
      type: string;
      uuid?: string;
      [key: string]: unknown;
    };

export interface ClaudeAssistantMessageLike {
  error?: string;
  message: {
    content?: ClaudeContentBlockLike[];
    usage?: ClaudeUsageLike;
    [key: string]: unknown;
  };
  parent_tool_use_id?: string | null;
  session_id: string;
  type: "assistant";
  uuid?: string;
}

export interface ClaudeUserMessageLike {
  message: {
    content?: ClaudeContentBlockLike[] | string;
    role?: "user";
    [key: string]: unknown;
  };
  parent_tool_use_id?: string | null;
  session_id: string;
  type: "user";
  uuid?: string;
}

export interface ClaudeResultMessageLike {
  duration_api_ms?: number;
  duration_ms?: number;
  errors?: string[];
  is_error?: boolean;
  modelUsage?: Record<string, ClaudeUsageLike>;
  num_turns?: number;
  permission_denials?: Array<{
    tool_input?: Record<string, unknown>;
    tool_name?: string;
    tool_use_id?: string;
  }>;
  result?: string;
  session_id: string;
  stop_reason?: string | null;
  structured_output?: unknown;
  subtype: "success" | string;
  total_cost_usd?: number;
  type: "result";
  usage?: ClaudeUsageLike;
  uuid?: string;
}

export interface ClaudeSystemMessageLike {
  content?: string;
  cwd?: string;
  hook_event?: string;
  hook_id?: string;
  hook_name?: string;
  message?: string;
  model?: string;
  mcp_servers?: Array<{
    name: string;
    status: string;
  }>;
  output?: string;
  permissionMode?: string;
  session_id: string;
  stderr?: string;
  stdout?: string;
  subtype?: string;
  tool_name?: string;
  tool_use_id?: string;
  tools?: string[];
  type: "system";
  uuid?: string;
  [key: string]: unknown;
}

export interface ClaudeStreamEventMessageLike {
  event: ClaudeRawStreamEventLike;
  parent_tool_use_id?: string | null;
  session_id: string;
  type: "stream_event";
  uuid?: string;
}

export interface ClaudeRawStreamEventLike {
  delta?: {
    text?: string;
    type?: string;
    [key: string]: unknown;
  };
  message?: {
    usage?: ClaudeUsageLike;
    [key: string]: unknown;
  };
  type?: string;
  usage?: ClaudeUsageLike;
  [key: string]: unknown;
}

export type ClaudeContentBlockLike =
  | {
      text?: string;
      type: "text";
      [key: string]: unknown;
    }
  | {
      id?: string;
      input?: Record<string, unknown>;
      name?: string;
      type: "tool_use" | "server_tool_use";
      [key: string]: unknown;
    }
  | {
      content?: unknown;
      is_error?: boolean;
      tool_use_id?: string;
      type: "tool_result";
      [key: string]: unknown;
    }
  | {
      type?: string;
      [key: string]: unknown;
    };

export interface ClaudeUsageLike {
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  [key: string]: unknown;
}

export interface ClaudeNativeSession {
  baseOptions: ClaudeOptionsLike;
  cwd: string;
  mode: "sdk";
  query: ClaudeQueryFunction;
}

export interface ClaudeNativeRun {
  abortController: AbortController;
  completed: boolean;
  cwd: string;
  events: PortableRunEvent[];
  finalResult?: ClaudeResultMessageLike;
  finalStatus?: RunResult["status"];
  input: RunInput;
  mode: "sdk";
  options: ClaudeOptionsLike;
  query: ClaudeQueryLike;
  seq: number;
  streamConsumed: boolean;
}

export type ClaudeSessionHandle = SessionHandle<ClaudeNativeSession>;
export type ClaudeRunHandle = RunHandle<ClaudeNativeRun>;
