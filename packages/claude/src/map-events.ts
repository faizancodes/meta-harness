import { createEventId, hashTask, nowIso } from "@metaharness/core";
import type {
  ClaudeAssistantMessageLike,
  ClaudeContentBlockLike,
  ClaudeResultMessageLike,
  ClaudeRunHandle,
  ClaudeSdkMessageLike,
  ClaudeStreamEventMessageLike,
  ClaudeSystemMessageLike,
  ClaudeUsageLike,
  ClaudeUserMessageLike
} from "./types.js";
import type {
  BaseEvent,
  NormalizedError,
  PortableRunEvent,
  RunResult
} from "@metaharness/core";

type ClaudeEventBase = Omit<BaseEvent, "provider"> & {
  provider: "claude";
};

type PortableEventPayload = {
  severity?: BaseEvent["severity"];
  type: PortableRunEvent["type"];
  [key: string]: unknown;
};

export function createRunStartedEvent(run: ClaudeRunHandle): PortableRunEvent {
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
  run: ClaudeRunHandle,
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
  run: ClaudeRunHandle,
  raw: unknown,
  providerEventType?: string
): PortableRunEvent {
  return appendEvent(run, {
    ...(providerEventType ? { providerEventType } : {}),
    raw,
    type: "provider.raw"
  });
}

export function createErrorEvent(run: ClaudeRunHandle, error: unknown): PortableRunEvent {
  return appendEvent(run, {
    error: normalizeError(error),
    severity: "error",
    type: "error"
  });
}

export function createRunCompletedEvent(
  run: ClaudeRunHandle,
  status: RunResult["status"],
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

export function mapClaudeMessageToEvents(
  run: ClaudeRunHandle,
  message: ClaudeSdkMessageLike
): PortableRunEvent[] {
  captureSessionId(run, message);

  if (message.type === "stream_event") {
    return mapStreamEvent(run, message as ClaudeStreamEventMessageLike);
  }
  if (message.type === "assistant") {
    return mapAssistantMessage(run, message as ClaudeAssistantMessageLike);
  }
  if (message.type === "user") {
    return mapUserMessage(run, message as ClaudeUserMessageLike);
  }
  if (message.type === "result") {
    return mapResultMessage(run, message as ClaudeResultMessageLike);
  }
  if (message.type === "system") {
    return mapSystemMessage(run, message as ClaudeSystemMessageLike);
  }
  return [];
}

export function mapClaudeResultToRunResult(run: ClaudeRunHandle): RunResult {
  const resultMessage = run.native.finalResult;
  const status = run.native.finalStatus ?? resultStatus(resultMessage);
  const finalMessage = resultMessage ? resultText(resultMessage) : undefined;
  const result: RunResult = {
    artifacts: [],
    provider: "claude",
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
  if (resultMessage?.uuid) {
    result.nativeRunId = resultMessage.uuid;
  }
  if (resultMessage?.usage || typeof resultMessage?.total_cost_usd === "number") {
    result.usage = mapUsage(resultMessage.usage, resultMessage.total_cost_usd);
  }
  if (resultMessage) {
    result.native = resultMessage;
  }
  return result;
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return {
      cause: error.cause,
      message: error.message
    };
  }
  if (typeof error === "string") {
    return {
      message: error
    };
  }
  if (isRecord(error) && typeof error.message === "string") {
    return {
      cause: error,
      message: error.message
    };
  }
  return {
    cause: error,
    message: "Unknown Claude Agent SDK error."
  };
}

function mapStreamEvent(
  run: ClaudeRunHandle,
  message: ClaudeStreamEventMessageLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  const text = extractStreamDeltaText(message);
  if (text) {
    events.push(
      appendEvent(run, {
        phase: "commentary",
        text,
        type: "assistant.message.delta"
      })
    );
  }
  const usage = message.event.usage ?? message.event.message?.usage;
  if (usage) {
    events.push(createUsageEvent(run, usage));
  }
  return events;
}

function mapAssistantMessage(
  run: ClaudeRunHandle,
  message: ClaudeAssistantMessageLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  if (message.error) {
    events.push(
      appendEvent(run, {
        error: {
          message: `Claude assistant message error: ${message.error}`,
          providerCode: message.error
        },
        severity: "error",
        type: "error"
      })
    );
  }
  for (const block of contentBlocks(message.message.content)) {
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      events.push(
        appendEvent(run, {
          phase: "commentary",
          text: block.text,
          type: "assistant.message.completed"
        })
      );
    }
    if (
      (block.type === "tool_use" || block.type === "server_tool_use") &&
      typeof block.name === "string"
    ) {
      events.push(
        appendEvent(run, {
          input: block.input,
          tool: {
            kind: toolKind(block.name),
            name: block.name
          },
          type: "tool.started"
        })
      );
    }
  }
  if (message.message.usage) {
    events.push(createUsageEvent(run, message.message.usage));
  }
  return events;
}

function mapUserMessage(
  run: ClaudeRunHandle,
  message: ClaudeUserMessageLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  for (const block of contentBlocks(message.message.content)) {
    if (block.type !== "tool_result") {
      continue;
    }
    events.push(
      appendEvent(run, {
        ...(block.is_error
          ? {
              error: {
                message: stringifyToolOutput(block.content)
              }
            }
          : {
              output: block.content
            }),
        tool: {
          kind: "unknown",
          name: block.tool_use_id ?? "tool_result"
        },
        type: "tool.finished"
      })
    );
  }
  return events;
}

function mapResultMessage(
  run: ClaudeRunHandle,
  message: ClaudeResultMessageLike
): PortableRunEvent[] {
  run.native.finalResult = message;
  run.native.finalStatus = resultStatus(message);
  const events: PortableRunEvent[] = [];
  const finalMessage = resultText(message);
  if (finalMessage && !hasAssistantCompletedEvent(run, finalMessage)) {
    events.push(
      appendEvent(run, {
        phase: "final",
        text: finalMessage,
        type: "assistant.message.completed"
      })
    );
  }
  if (message.usage || typeof message.total_cost_usd === "number") {
    events.push(createUsageEvent(run, message.usage, message.total_cost_usd));
  }
  for (const denial of message.permission_denials ?? []) {
    if (!denial.tool_use_id) {
      continue;
    }
    events.push(
      appendEvent(run, {
        approvalId: denial.tool_use_id,
        decision: "decline",
        type: "approval.resolved"
      })
    );
  }
  const partial: Partial<RunResult> = {
    status: resultStatus(message)
  };
  if (finalMessage) {
    partial.finalMessage = finalMessage;
  }
  if (message.usage || typeof message.total_cost_usd === "number") {
    partial.usage = mapUsage(message.usage, message.total_cost_usd);
  }
  events.push(createRunCompletedEvent(run, resultStatus(message), finalMessage, partial));
  return events;
}

function mapSystemMessage(
  run: ClaudeRunHandle,
  message: ClaudeSystemMessageLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  if (message.subtype === "hook_started" && message.hook_event === "PermissionRequest") {
    events.push(
      appendEvent(run, {
        approvalId: message.hook_id ?? message.uuid ?? createSyntheticApprovalId(run),
        availableDecisions: ["accept", "accept_for_session", "decline", "cancel"],
        category: "provider_native",
        native: message,
        reason: "Claude permission request hook started.",
        type: "approval.requested"
      })
    );
  }
  if (message.subtype === "hook_response" && message.hook_event === "PermissionRequest") {
    events.push(
      appendEvent(run, {
        approvalId: message.hook_id ?? message.uuid ?? createSyntheticApprovalId(run),
        decision: message.output?.includes("deny") ? "decline" : "accept",
        type: "approval.resolved"
      })
    );
  }
  if (message.subtype === "permission_denied" && message.tool_use_id) {
    events.push(
      appendEvent(run, {
        approvalId: message.tool_use_id,
        decision: "decline",
        type: "approval.resolved"
      }),
      appendEvent(run, {
        error: {
          message: message.message ?? "Claude denied tool permission."
        },
        tool: {
          kind: toolKind(message.tool_name ?? "unknown"),
          name: message.tool_name ?? "unknown"
        },
        type: "tool.finished"
      })
    );
  }
  if (message.subtype === "local_command_output" && message.content) {
    events.push(
      appendEvent(run, {
        phase: "commentary",
        text: message.content,
        type: "assistant.message.delta"
      })
    );
  }
  if (message.subtype === "hook_progress" && message.output) {
    events.push(
      appendEvent(run, {
        data: {
          hookEvent: message.hook_event,
          hookName: message.hook_name
        },
        text: message.output,
        type: "tool.delta"
      })
    );
  }
  return events;
}

function createUsageEvent(
  run: ClaudeRunHandle,
  usage: ClaudeUsageLike | undefined,
  estimatedCostUsd?: number
): PortableRunEvent {
  return appendEvent(run, {
    usage: mapUsage(usage, estimatedCostUsd),
    type: "usage.updated"
  });
}

function mapUsage(
  usage: ClaudeUsageLike | undefined,
  estimatedCostUsd?: number
): NonNullable<RunResult["usage"]> {
  const inputTokens = numberAt(usage, "input_tokens");
  const outputTokens = numberAt(usage, "output_tokens");
  const cacheReadTokens = numberAt(usage, "cache_read_input_tokens");
  const cacheWriteTokens = numberAt(usage, "cache_creation_input_tokens");
  const totalTokens =
    (inputTokens ?? 0) +
    (outputTokens ?? 0) +
    (cacheReadTokens ?? 0) +
    (cacheWriteTokens ?? 0);
  const mapped: NonNullable<RunResult["usage"]> = {};
  if (typeof inputTokens === "number") {
    mapped.inputTokens = inputTokens;
  }
  if (typeof outputTokens === "number") {
    mapped.outputTokens = outputTokens;
  }
  if (typeof cacheReadTokens === "number") {
    mapped.cacheReadTokens = cacheReadTokens;
  }
  if (typeof cacheWriteTokens === "number") {
    mapped.cacheWriteTokens = cacheWriteTokens;
  }
  if (totalTokens > 0) {
    mapped.totalTokens = totalTokens;
  }
  if (typeof estimatedCostUsd === "number") {
    mapped.estimatedCostUsd = estimatedCostUsd;
  }
  return mapped;
}

function resultStatus(message: ClaudeResultMessageLike | undefined): RunResult["status"] {
  if (!message) {
    return "success";
  }
  return message.subtype === "success" && !message.is_error ? "success" : "failed";
}

function resultText(message: ClaudeResultMessageLike): string | undefined {
  if (typeof message.result === "string" && message.result) {
    return message.result;
  }
  if (message.errors?.length) {
    return message.errors.join("\n");
  }
  return undefined;
}

function extractStreamDeltaText(
  message: ClaudeStreamEventMessageLike
): string | undefined {
  const event = message.event;
  if (
    event.type === "content_block_delta" &&
    event.delta?.type === "text_delta" &&
    typeof event.delta.text === "string"
  ) {
    return event.delta.text;
  }
  if (typeof event.delta?.text === "string") {
    return event.delta.text;
  }
  return undefined;
}

function captureSessionId(run: ClaudeRunHandle, message: ClaudeSdkMessageLike): void {
  if ("session_id" in message && typeof message.session_id === "string") {
    run.nativeSessionId = message.session_id;
  }
}

function contentBlocks(value: unknown): ClaudeContentBlockLike[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is ClaudeContentBlockLike => isRecord(item));
  }
  return [];
}

function hasAssistantCompletedEvent(run: ClaudeRunHandle, text: string): boolean {
  return run.native.events.some(
    (event) => event.type === "assistant.message.completed" && event.text === text
  );
}

function toolKind(
  name: string
): Extract<PortableRunEvent, { type: "tool.started" }>["tool"]["kind"] {
  return name.startsWith("mcp__") ? "mcp" : "provider_native";
}

function stringifyToolOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Claude tool result failed.";
  }
}

function createSyntheticApprovalId(run: ClaudeRunHandle): string {
  return `${run.runId}-approval-${run.native.seq + 1}`;
}

function baseEvent(run: ClaudeRunHandle): ClaudeEventBase {
  const seq = run.native.seq + 1;
  return {
    id: createEventId(run.runId, seq),
    provider: "claude",
    runId: run.runId,
    seq,
    sessionId: run.sessionId,
    ts: nowIso()
  };
}

function appendEvent(
  run: ClaudeRunHandle,
  event: PortableEventPayload
): PortableRunEvent {
  return recordPreparedEvent(run, {
    ...baseEvent(run),
    ...event
  } as PortableRunEvent);
}

function recordPreparedEvent<TEvent extends PortableRunEvent>(
  run: ClaudeRunHandle,
  event: TEvent
): TEvent {
  run.native.seq = event.seq;
  run.native.events.push(event);
  return event;
}

function numberAt(
  value: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
