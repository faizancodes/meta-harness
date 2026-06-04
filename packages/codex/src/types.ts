import type {
  CodexAppServerClientFactory,
  CodexAppServerClientLike,
  CodexAppServerClientConfig,
  CodexAppServerApprovalResolver,
  CodexAppServerNativeRun,
  CodexAppServerNativeSession,
  CodexAppServerThreadLike,
  CodexAppServerThreadResumeParamsLike,
  CodexAppServerThreadStartParamsLike,
  CodexAppServerTurnLike,
  CodexAppServerTurnStartParamsLike
} from "./appserver/protocol.js";
import type {
  PortableRunEvent,
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle
} from "@metaharness/core";

export type MetaharnessCodexSandboxMode = "read-only" | "workspace-write" | "full-access";

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";

export type CodexWebSearchMode = "disabled" | "cached" | "live";

export interface CodexOptionsLike {
  apiKey?: string;
  baseUrl?: string;
  codexPathOverride?: string;
  config?: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface CodexThreadOptionsLike {
  additionalDirectories?: string[];
  approvalPolicy?: CodexApprovalPolicy;
  model?: string;
  modelReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  networkAccessEnabled?: boolean;
  sandboxMode?: CodexSandboxMode;
  skipGitRepoCheck?: boolean;
  webSearchEnabled?: boolean;
  webSearchMode?: CodexWebSearchMode;
  workingDirectory?: string;
}

export interface CodexTurnOptionsLike {
  outputSchema?: unknown;
  signal?: AbortSignal;
}

export interface CodexSdkModule {
  Codex: new (options?: CodexOptionsLike) => CodexClientLike;
}

export type CodexSdkLoader = () => Promise<CodexSdkModule>;

export interface CodexAdapterOptions {
  appServerApprovalResolver?: CodexAppServerApprovalResolver;
  appServerClientFactory?: CodexAppServerClientFactory;
  loadSdk?: CodexSdkLoader;
}

export interface CodexClientLike {
  resumeThread(
    id: string,
    options?: CodexThreadOptionsLike
  ): CodexThreadLike | Promise<CodexThreadLike>;
  startThread(
    options?: CodexThreadOptionsLike
  ): CodexThreadLike | Promise<CodexThreadLike>;
}

export interface CodexThreadLike {
  readonly id?: string | null;
  readonly threadId?: string | null;
  run(input: CodexInputLike, options?: CodexTurnOptionsLike): Promise<CodexTurnLike>;
  runStreamed?(
    input: CodexInputLike,
    options?: CodexTurnOptionsLike
  ): Promise<CodexStreamedTurnLike>;
}

export type CodexInputLike =
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "local_image";
          path: string;
        }
    >;

export interface CodexStreamedTurnLike {
  events: AsyncIterable<CodexThreadEventLike>;
}

export interface CodexTurnLike {
  finalResponse?: string;
  items?: CodexThreadItemLike[];
  usage?: CodexUsageLike | null;
  [key: string]: unknown;
}

export interface CodexUsageLike {
  cached_input_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  [key: string]: unknown;
}

export type CodexThreadEventLike =
  | {
      type: "thread.started";
      thread_id: string;
    }
  | {
      type: "turn.started";
    }
  | {
      type: "turn.completed";
      usage?: CodexUsageLike | null;
    }
  | {
      type: "turn.failed";
      error?: CodexErrorLike;
    }
  | {
      type: "item.started" | "item.updated" | "item.completed";
      item: CodexThreadItemLike;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

export type CodexThreadItemLike =
  | CodexAgentMessageItemLike
  | CodexReasoningItemLike
  | CodexCommandExecutionItemLike
  | CodexFileChangeItemLike
  | CodexMcpToolCallItemLike
  | CodexWebSearchItemLike
  | CodexTodoListItemLike
  | CodexErrorItemLike
  | {
      id?: string;
      type: string;
      [key: string]: unknown;
    };

export interface CodexAgentMessageItemLike {
  id: string;
  text: string;
  type: "agent_message";
}

export interface CodexReasoningItemLike {
  id: string;
  text: string;
  type: "reasoning";
}

export interface CodexCommandExecutionItemLike {
  aggregated_output?: string;
  command: string;
  exit_code?: number;
  id: string;
  status: "in_progress" | "completed" | "failed";
  type: "command_execution";
}

export interface CodexFileChangeItemLike {
  changes: Array<{
    kind: "add" | "delete" | "update";
    path: string;
  }>;
  id: string;
  status: "completed" | "failed";
  type: "file_change";
}

export interface CodexMcpToolCallItemLike {
  arguments?: unknown;
  error?: {
    message?: string;
  };
  id: string;
  result?: unknown;
  server: string;
  status: "in_progress" | "completed" | "failed";
  tool: string;
  type: "mcp_tool_call";
}

export interface CodexWebSearchItemLike {
  id: string;
  query: string;
  type: "web_search";
}

export interface CodexTodoListItemLike {
  id: string;
  items: Array<{
    completed: boolean;
    text: string;
  }>;
  type: "todo_list";
}

export interface CodexErrorItemLike {
  id: string;
  message: string;
  type: "error";
}

export interface CodexErrorLike {
  message?: string;
  [key: string]: unknown;
}

export interface CodexSdkNativeSession {
  client: CodexClientLike;
  cwd: string;
  mode: "sdk";
  thread: CodexThreadLike;
  threadOptions: CodexThreadOptionsLike;
}

export interface CodexSdkNativeRun {
  abortController: AbortController;
  completed: boolean;
  cwd: string;
  events: PortableRunEvent[];
  finalResult?: CodexTurnLike;
  input: RunInput;
  mode: "sdk";
  resultPromise?: Promise<CodexTurnLike>;
  seq: number;
  streamConsumed: boolean;
  streamedEvents?: AsyncIterable<CodexThreadEventLike>;
  thread: CodexThreadLike;
}

export type CodexNativeSession = CodexSdkNativeSession | CodexAppServerNativeSession;
export type CodexNativeRun = CodexSdkNativeRun | CodexAppServerNativeRun;

export type CodexSessionHandle = SessionHandle<CodexNativeSession>;
export type CodexRunHandle = RunHandle<CodexNativeRun>;

export type {
  CodexAppServerClientConfig,
  CodexAppServerClientFactory,
  CodexAppServerClientLike,
  CodexAppServerNativeRun,
  CodexAppServerNativeSession,
  CodexAppServerThreadLike,
  CodexAppServerThreadResumeParamsLike,
  CodexAppServerThreadStartParamsLike,
  CodexAppServerTurnLike,
  CodexAppServerTurnStartParamsLike
};

export interface CodexMappedResult {
  result: RunResult;
  usage?: RunResult["usage"];
}
