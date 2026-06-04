import { createEventId, hashTask, nowIso } from "@metaharness/core";
import type {
  CodexCommandExecutionItemLike,
  CodexErrorLike,
  CodexFileChangeItemLike,
  CodexMcpToolCallItemLike,
  CodexThreadEventLike,
  CodexThreadItemLike,
  CodexTodoListItemLike,
  CodexTurnLike,
  CodexUsageLike,
  CodexWebSearchItemLike
} from "./types.js";
import type {
  BaseEvent,
  FileChangeKind,
  NormalizedError,
  PortableRunEvent,
  RunResult
} from "@metaharness/core";
import type { CodexRunHandle } from "./types.js";

type CodexEventBase = Omit<BaseEvent, "provider"> & {
  provider: "codex";
};

type PortableEventPayload = {
  severity?: BaseEvent["severity"];
  type: PortableRunEvent["type"];
  [key: string]: unknown;
};

export function createRunStartedEvent(run: CodexRunHandle): PortableRunEvent {
  return appendEvent(run, {
    input: {
      cwd: run.native.cwd,
      mode: run.native.input.mode ?? "edit",
      taskHash: hashTask(run.native.input.task)
    },
    type: "run.started"
  });
}

export function createRunStatusEvent(
  run: CodexRunHandle,
  status: Extract<PortableRunEvent, { type: "run.status" }>["status"],
  message?: string
): PortableRunEvent {
  return appendEvent(run, {
    ...(message ? { message } : {}),
    status,
    type: "run.status"
  });
}

export function createRawProviderEvent(
  run: CodexRunHandle,
  raw: unknown,
  providerEventType?: string
): PortableRunEvent {
  return appendEvent(run, {
    ...(providerEventType ? { providerEventType } : {}),
    raw,
    type: "provider.raw"
  });
}

export function createRunCompletedEvent(
  run: CodexRunHandle,
  status: "success" | "failed" | "cancelled",
  finalMessage?: string,
  result?: Partial<RunResult>
): PortableRunEvent {
  return appendEvent(run, {
    ...(finalMessage ? { finalMessage } : {}),
    ...(result ? { result } : {}),
    status,
    type: "run.completed"
  });
}

export function createErrorEvent(run: CodexRunHandle, error: unknown): PortableRunEvent {
  return appendEvent(run, {
    error: normalizeError(error),
    severity: "error",
    type: "error"
  });
}

export function mapCodexThreadEvent(
  run: CodexRunHandle,
  event: CodexThreadEventLike
): PortableRunEvent[] {
  switch (event.type) {
    case "thread.started":
      if (typeof event.thread_id === "string") {
        run.nativeSessionId = event.thread_id;
      }
      return [];
    case "turn.started":
      return [createRunStatusEvent(run, "running")];
    case "turn.completed":
      return mapTurnCompletedEvent(run, normalizeUsage(event.usage));
    case "turn.failed": {
      const error = normalizeError(event.error ?? { message: "Codex turn failed." });
      return [
        appendEvent(run, {
          error,
          severity: "error",
          type: "error"
        }),
        createRunCompletedEvent(run, "failed", error.message, {
          status: "failed"
        })
      ];
    }
    case "error": {
      const error = normalizeError({ message: event.message });
      return [
        appendEvent(run, {
          error,
          severity: "error",
          type: "error"
        }),
        createRunCompletedEvent(run, "failed", error.message, {
          status: "failed"
        })
      ];
    }
    case "item.started":
    case "item.updated":
    case "item.completed":
      return mapCodexItemEvent(run, event.type, event.item as CodexThreadItemLike);
    default:
      return [];
  }
}

export function mapCodexTurnResult(
  run: CodexRunHandle,
  turn: CodexTurnLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  for (const item of turn.items ?? []) {
    events.push(...mapCodexItemEvent(run, "item.completed", item));
  }
  const finalResponse = getFinalResponse(turn);
  if (finalResponse && !hasAssistantCompletedEvent(run, finalResponse)) {
    events.push(
      appendEvent(run, {
        phase: "final",
        text: finalResponse,
        type: "assistant.message.completed"
      })
    );
  }
  if (turn.usage) {
    events.push(createUsageEvent(run, turn.usage));
  }
  const result: Partial<RunResult> = {
    status: "success"
  };
  if (finalResponse) {
    result.finalMessage = finalResponse;
  }
  if (turn.usage) {
    result.usage = mapUsage(turn.usage);
  }
  events.push(createRunCompletedEvent(run, "success", finalResponse, result));
  return events;
}

export function mapCodexResultToRunResult(
  run: CodexRunHandle,
  turn: CodexTurnLike | undefined,
  status: "success" | "failed" | "cancelled" = "success"
): RunResult {
  const finalMessage = turn ? getFinalResponse(turn) : undefined;
  const result: RunResult = {
    artifacts: [],
    provider: "codex",
    runId: run.runId,
    sessionId: run.sessionId,
    status
  };
  if (finalMessage) {
    result.finalMessage = finalMessage;
  }
  if (run.nativeSessionId) {
    result.nativeSessionId = run.nativeSessionId;
  }
  if (run.nativeRunId) {
    result.nativeRunId = run.nativeRunId;
  }
  if (turn?.usage) {
    result.usage = mapUsage(turn.usage);
  }
  if (turn) {
    result.native = turn;
  }
  return result;
}

export function getFinalResponse(turn: CodexTurnLike): string | undefined {
  if (typeof turn.finalResponse === "string" && turn.finalResponse.length > 0) {
    return turn.finalResponse;
  }
  const lastAgentMessage = [...(turn.items ?? [])]
    .reverse()
    .find((item) => item.type === "agent_message");
  if (
    lastAgentMessage &&
    "text" in lastAgentMessage &&
    typeof lastAgentMessage.text === "string"
  ) {
    return lastAgentMessage.text;
  }
  return undefined;
}

export function mapUsage(usage: CodexUsageLike): NonNullable<RunResult["usage"]> {
  const inputTokens = numberAt(usage, "input_tokens");
  const outputTokens = numberAt(usage, "output_tokens");
  const cacheReadTokens = numberAt(usage, "cached_input_tokens");
  const reasoningTokens = numberAt(usage, "reasoning_output_tokens") ?? 0;
  const totalTokens =
    typeof inputTokens === "number" || typeof outputTokens === "number"
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined;
  const mapped: NonNullable<RunResult["usage"]> = {};
  if (typeof inputTokens === "number") {
    mapped.inputTokens = inputTokens;
  }
  if (typeof outputTokens === "number") {
    mapped.outputTokens = outputTokens + reasoningTokens;
  }
  if (typeof cacheReadTokens === "number") {
    mapped.cacheReadTokens = cacheReadTokens;
  }
  if (typeof totalTokens === "number") {
    mapped.totalTokens = totalTokens + reasoningTokens;
  }
  return mapped;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      cause: error.cause,
      message: error.message
    };
  }
  if (isCodexErrorLike(error) && error.message) {
    return {
      cause: error,
      message: error.message
    };
  }
  if (typeof error === "string") {
    return {
      message: error
    };
  }
  return {
    cause: error,
    message: "Unknown Codex SDK error."
  };
}

function mapTurnCompletedEvent(
  run: CodexRunHandle,
  usage: CodexUsageLike | undefined
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  if (usage) {
    events.push(createUsageEvent(run, usage));
  }
  return events;
}

function mapCodexItemEvent(
  run: CodexRunHandle,
  providerEventType: "item.started" | "item.updated" | "item.completed",
  item: CodexThreadItemLike
): PortableRunEvent[] {
  switch (item.type) {
    case "agent_message":
      return mapAgentMessageItem(
        run,
        providerEventType,
        item as Extract<CodexThreadItemLike, { type: "agent_message" }>
      );
    case "reasoning":
      return mapReasoningItem(
        run,
        providerEventType,
        item as Extract<CodexThreadItemLike, { type: "reasoning" }>
      );
    case "todo_list":
      return [mapTodoListItem(run, item as CodexTodoListItemLike)];
    case "command_execution":
      return mapCommandItem(
        run,
        providerEventType,
        item as CodexCommandExecutionItemLike
      );
    case "file_change":
      return mapFileChangeItem(run, providerEventType, item as CodexFileChangeItemLike);
    case "mcp_tool_call":
      return mapMcpToolItem(run, providerEventType, item as CodexMcpToolCallItemLike);
    case "web_search":
      return mapWebSearchItem(run, providerEventType, item as CodexWebSearchItemLike);
    case "error":
      return [
        appendEvent(run, {
          error: normalizeError({ message: item.message }),
          severity: "error",
          type: "error"
        })
      ];
    default:
      return [];
  }
}

function mapAgentMessageItem(
  run: CodexRunHandle,
  providerEventType: "item.started" | "item.updated" | "item.completed",
  item: Extract<CodexThreadItemLike, { type: "agent_message" }>
): PortableRunEvent[] {
  if (!item.text) {
    return [];
  }
  if (providerEventType === "item.completed") {
    return [
      appendEvent(run, {
        phase: "final",
        text: item.text,
        type: "assistant.message.completed"
      })
    ];
  }
  return [
    appendEvent(run, {
      phase: "commentary",
      text: item.text,
      type: "assistant.message.delta"
    })
  ];
}

function mapReasoningItem(
  run: CodexRunHandle,
  providerEventType: "item.started" | "item.updated" | "item.completed",
  item: Extract<CodexThreadItemLike, { type: "reasoning" }>
): PortableRunEvent[] {
  if (!item.text || providerEventType === "item.completed") {
    return [];
  }
  return [
    appendEvent(run, {
      phase: "commentary",
      text: item.text,
      type: "assistant.message.delta"
    })
  ];
}

function mapTodoListItem(
  run: CodexRunHandle,
  item: CodexTodoListItemLike
): PortableRunEvent {
  return appendEvent(run, {
    steps: item.items.map((todo) => ({
      status: todo.completed ? "completed" : "pending",
      step: todo.text
    })),
    type: "plan.updated"
  });
}

function mapCommandItem(
  run: CodexRunHandle,
  providerEventType: "item.started" | "item.updated" | "item.completed",
  item: CodexCommandExecutionItemLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  if (providerEventType === "item.started") {
    events.push(
      appendEvent(run, {
        command: item.command,
        cwd: run.native.cwd,
        type: "command.started"
      })
    );
  }
  if (item.aggregated_output) {
    events.push(
      appendEvent(run, {
        commandId: item.id,
        stream: "combined",
        text: item.aggregated_output,
        type: "command.output.delta"
      })
    );
  }
  if (providerEventType === "item.completed" || item.status !== "in_progress") {
    const finish: Extract<PortableRunEvent, { type: "command.finished" }> = {
      ...baseEvent(run),
      command: item.command,
      cwd: run.native.cwd,
      type: "command.finished"
    };
    if (item.aggregated_output) {
      finish.outputSummary = item.aggregated_output;
    }
    if (typeof item.exit_code === "number") {
      finish.exitCode = item.exit_code;
    }
    if (item.status === "failed") {
      finish.error = {
        message: `Codex command failed: ${item.command}`
      };
    }
    events.push(recordPreparedEvent(run, finish));
  }
  return events;
}

function mapFileChangeItem(
  run: CodexRunHandle,
  providerEventType: "item.started" | "item.updated" | "item.completed",
  item: CodexFileChangeItemLike
): PortableRunEvent[] {
  return item.changes.map((change) => {
    const changeKind = mapFileChangeKind(change.kind);
    if (providerEventType === "item.started") {
      return appendEvent(run, {
        changeKind,
        path: change.path,
        type: "file.change.started"
      });
    }
    if (providerEventType === "item.updated") {
      return appendEvent(run, {
        path: change.path,
        type: "file.change.updated"
      });
    }
    return appendEvent(run, {
      changeKind,
      path: change.path,
      status: item.status === "completed" ? "completed" : "failed",
      type: "file.change.finished"
    });
  });
}

function mapMcpToolItem(
  run: CodexRunHandle,
  providerEventType: "item.started" | "item.updated" | "item.completed",
  item: CodexMcpToolCallItemLike
): PortableRunEvent[] {
  if (providerEventType === "item.started") {
    return [
      appendEvent(run, {
        input: item.arguments,
        tool: {
          kind: "mcp",
          name: item.tool,
          server: item.server
        },
        type: "tool.started"
      })
    ];
  }
  if (providerEventType === "item.updated") {
    return [
      appendEvent(run, {
        data: {
          status: item.status
        },
        toolCallId: item.id,
        type: "tool.delta"
      })
    ];
  }
  return [
    appendEvent(run, {
      ...(item.error?.message
        ? {
            error: {
              message: item.error.message
            }
          }
        : { output: item.result }),
      tool: {
        kind: "mcp",
        name: item.tool,
        server: item.server
      },
      type: "tool.finished"
    })
  ];
}

function mapWebSearchItem(
  run: CodexRunHandle,
  providerEventType: "item.started" | "item.updated" | "item.completed",
  item: CodexWebSearchItemLike
): PortableRunEvent[] {
  if (providerEventType === "item.updated") {
    return [];
  }
  const tool = {
    kind: "provider_native" as const,
    name: "web_search"
  };
  if (providerEventType === "item.started") {
    return [
      appendEvent(run, {
        input: {
          query: item.query
        },
        tool,
        type: "tool.started"
      })
    ];
  }
  return [
    appendEvent(run, {
      output: {
        query: item.query
      },
      tool,
      type: "tool.finished"
    })
  ];
}

function createUsageEvent(run: CodexRunHandle, usage: CodexUsageLike): PortableRunEvent {
  return appendEvent(run, {
    usage: mapUsage(usage),
    type: "usage.updated"
  });
}

function mapFileChangeKind(
  kind: CodexFileChangeItemLike["changes"][number]["kind"]
): FileChangeKind {
  if (kind === "add") {
    return "create";
  }
  if (kind === "delete") {
    return "delete";
  }
  return "modify";
}

function hasAssistantCompletedEvent(run: CodexRunHandle, text: string): boolean {
  return run.native.events.some(
    (event) => event.type === "assistant.message.completed" && event.text === text
  );
}

function baseEvent(run: CodexRunHandle): CodexEventBase {
  const seq = run.native.seq + 1;
  return {
    id: createEventId(run.runId, seq),
    provider: "codex",
    runId: run.runId,
    seq,
    sessionId: run.sessionId,
    ts: nowIso()
  };
}

function appendEvent(run: CodexRunHandle, event: PortableEventPayload): PortableRunEvent {
  return recordPreparedEvent(run, {
    ...baseEvent(run),
    ...event
  } as PortableRunEvent);
}

function recordPreparedEvent<TEvent extends PortableRunEvent>(
  run: CodexRunHandle,
  event: TEvent
): TEvent {
  run.native.seq = event.seq;
  run.native.events.push(event);
  return event;
}

function numberAt(value: Record<string, unknown>, key: string): number | undefined {
  const candidate = value[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function isCodexErrorLike(value: unknown): value is CodexErrorLike {
  return value !== null && typeof value === "object" && "message" in value;
}

export function normalizeUsage(value: unknown): CodexUsageLike | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as CodexUsageLike;
  }
  return undefined;
}
