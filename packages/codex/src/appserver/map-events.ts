import { createEventId, hashTask, nowIso } from "@metaharness/core";
import type {
  CodexAppServerAgentMessageItemLike,
  CodexAppServerCommandExecutionItemLike,
  CodexAppServerDynamicToolCallItemLike,
  CodexAppServerFileChangeItemLike,
  CodexAppServerFileUpdateChangeLike,
  CodexAppServerInboundMessage,
  CodexAppServerApprovalDecision,
  CodexAppServerJsonRpcId,
  CodexAppServerMcpToolCallItemLike,
  CodexAppServerNativeRun,
  CodexAppServerNotificationLike,
  CodexAppServerReasoningItemLike,
  CodexAppServerRequestResolution,
  CodexAppServerRequestLike,
  CodexAppServerThreadItemLike,
  CodexAppServerThreadTokenUsageLike,
  CodexAppServerTurnLike,
  CodexAppServerUsageBreakdownLike,
  CodexAppServerWebSearchItemLike
} from "./protocol.js";
import type { CodexTurnLike } from "../types.js";
import type {
  BaseEvent,
  FileChangeKind,
  NormalizedError,
  PortableRunEvent,
  RunHandle,
  RunResult
} from "@metaharness/core";

type CodexAppServerRunHandle = RunHandle<CodexAppServerNativeRun>;

type CodexEventBase = Omit<BaseEvent, "provider"> & {
  provider: "codex";
};

type PortableEventPayload = {
  severity?: BaseEvent["severity"];
  type: PortableRunEvent["type"];
  [key: string]: unknown;
};

export function createAppServerRunStartedEvent(
  run: CodexAppServerRunHandle
): PortableRunEvent {
  return appendEvent(run, {
    input: {
      cwd: run.native.cwd,
      mode: run.native.input.mode ?? "edit",
      taskHash: hashTask(run.native.input.task)
    },
    type: "run.started"
  });
}

export function createAppServerRunStatusEvent(
  run: CodexAppServerRunHandle,
  status: Extract<PortableRunEvent, { type: "run.status" }>["status"],
  message?: string
): PortableRunEvent {
  return appendEvent(run, {
    ...(message ? { message } : {}),
    status,
    type: "run.status"
  });
}

export function createAppServerRawProviderEvent(
  run: CodexAppServerRunHandle,
  raw: unknown,
  providerEventType?: string
): PortableRunEvent {
  return appendEvent(run, {
    ...(providerEventType ? { providerEventType } : {}),
    raw,
    type: "provider.raw"
  });
}

export function createAppServerErrorEvent(
  run: CodexAppServerRunHandle,
  error: unknown
): PortableRunEvent {
  return appendEvent(run, {
    error: normalizeAppServerError(error),
    severity: "error",
    type: "error"
  });
}

export function createAppServerRunCompletedEvent(
  run: CodexAppServerRunHandle,
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

export function mapCodexAppServerNotification(
  run: CodexAppServerRunHandle,
  notification: CodexAppServerNotificationLike
): PortableRunEvent[] {
  const params = asRecord(notification.params);
  switch (notification.method) {
    case "thread/started":
      captureThreadId(run, params);
      return [];
    case "thread/status/changed":
      return mapThreadStatus(run, params);
    case "turn/started":
      captureTurnId(run, params);
      return [createAppServerRunStatusEvent(run, "running")];
    case "turn/completed":
      return mapTurnCompleted(run, params);
    case "turn/diff/updated":
      return mapTurnDiffUpdated(run, params);
    case "turn/plan/updated":
      return mapTurnPlanUpdated(run, params);
    case "thread/tokenUsage/updated":
      return mapThreadTokenUsage(run, params);
    case "item/started":
      return mapItemEvent(run, "item.started", recordAt(params, "item"));
    case "item/completed":
      return mapItemEvent(run, "item.completed", recordAt(params, "item"));
    case "item/agentMessage/delta":
      return mapAgentMessageDelta(run, params);
    case "item/plan/delta":
      return mapPlanDelta(run, params);
    case "item/commandExecution/outputDelta":
      return mapCommandOutputDelta(run, params);
    case "item/fileChange/outputDelta":
      return mapFileChangeOutputDelta(run, params);
    case "item/fileChange/patchUpdated":
      return mapFileChangePatchUpdated(run, params);
    case "item/mcpToolCall/progress":
      return mapMcpToolProgress(run, params);
    case "serverRequest/resolved":
      return mapServerRequestResolved(run, params);
    case "error":
      return mapErrorNotification(run, params);
    default:
      return [];
  }
}

export function mapCodexAppServerRequest(
  run: CodexAppServerRunHandle,
  request: CodexAppServerRequestLike
): PortableRunEvent[] {
  const params = asRecord(request.params);
  const approval = approvalFromRequest(request.id, request.method, params);
  return [appendEvent(run, approval)];
}

export function resolveCodexAppServerRequest(
  request: CodexAppServerRequestLike
): CodexAppServerRequestResolution {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
      return {
        decision: "decline",
        result: {
          decision: "decline"
        }
      };
    case "item/fileChange/requestApproval":
      return {
        decision: "decline",
        result: {
          decision: "decline"
        }
      };
    case "execCommandApproval":
      return {
        decision: "decline",
        result: {
          decision: "denied"
        }
      };
    case "applyPatchApproval":
      return {
        decision: "decline",
        result: {
          decision: "denied"
        }
      };
    case "mcpServer/elicitation/request":
      return {
        decision: "decline",
        result: {
          _meta: null,
          action: "decline",
          content: null
        }
      };
    case "item/tool/requestUserInput":
      return {
        decision: "cancel",
        result: {
          answers: {}
        }
      };
    case "item/permissions/requestApproval":
      return {
        decision: "decline",
        result: {
          permissions: {},
          scope: "turn"
        }
      };
    case "item/tool/call":
      return {
        decision: "cancel",
        result: {
          contentItems: [],
          success: false
        }
      };
    case "account/chatgptAuthTokens/refresh":
      return {
        decision: "cancel",
        error: {
          code: -32001,
          message:
            "metaharness does not proxy ChatGPT consumer auth token refresh requests."
        }
      };
    default:
      return {
        decision: "cancel",
        error: {
          code: -32601,
          message: `Unsupported Codex app-server request "${request.method}".`
        }
      };
  }
}

export function createAppServerApprovalResolvedEvent(
  run: CodexAppServerRunHandle,
  requestId: CodexAppServerJsonRpcId,
  decision: CodexAppServerApprovalDecision
): PortableRunEvent {
  return appendEvent(run, {
    approvalId: String(requestId),
    decision,
    type: "approval.resolved"
  });
}

export function mapCodexAppServerResultToRunResult(
  run: CodexAppServerRunHandle
): RunResult {
  const finalMessage = getAppServerFinalMessage(run);
  const status = run.native.result?.status ?? "success";
  const result: RunResult = {
    artifacts: [],
    native: {
      mode: "app-server",
      threadId: run.native.threadId,
      turn: run.native.finalTurn,
      turnId: run.native.turnId
    },
    provider: "codex",
    runId: run.runId,
    sessionId: run.sessionId,
    status
  };
  if (finalMessage) {
    result.finalMessage = finalMessage;
  }
  if (run.native.threadId) {
    result.nativeSessionId = run.native.threadId;
  }
  if (run.native.turnId) {
    result.nativeRunId = run.native.turnId;
  }
  if (run.native.diff) {
    result.diff = run.native.diff;
  }
  if (run.native.usage) {
    result.usage = run.native.usage;
  }
  return result;
}

export function synthesizeCodexTurnFromAppServerEvents(
  run: CodexAppServerRunHandle
): CodexTurnLike {
  const finalResponse = getAppServerFinalMessage(run) ?? "";
  const turn: CodexTurnLike = {
    finalResponse,
    items: []
  };
  if (run.native.usage) {
    const usage: NonNullable<CodexTurnLike["usage"]> = {
      reasoning_output_tokens: 0
    };
    if (typeof run.native.usage.cacheReadTokens === "number") {
      usage.cached_input_tokens = run.native.usage.cacheReadTokens;
    }
    if (typeof run.native.usage.inputTokens === "number") {
      usage.input_tokens = run.native.usage.inputTokens;
    }
    if (typeof run.native.usage.outputTokens === "number") {
      usage.output_tokens = run.native.usage.outputTokens;
    }
    turn.usage = usage;
  }
  return turn;
}

export function normalizeAppServerError(error: unknown): NormalizedError {
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
    message: "Unknown Codex app-server error."
  };
}

function mapThreadStatus(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const status = recordAt(params, "status");
  const type = stringAt(status, "type");
  if (type === "active") {
    return [createAppServerRunStatusEvent(run, "running")];
  }
  if (type === "idle") {
    return [createAppServerRunStatusEvent(run, "completed")];
  }
  if (type === "systemError") {
    return [createAppServerRunStatusEvent(run, "failed")];
  }
  return [];
}

function mapTurnCompleted(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  const turn = recordAt(params, "turn") as CodexAppServerTurnLike | undefined;
  if (turn?.id) {
    run.native.turnId = turn.id;
  }
  if (turn) {
    run.native.finalTurn = turn;
  }
  if (Array.isArray(turn?.items)) {
    for (const item of turn.items) {
      events.push(...mapItemEvent(run, "item.completed", item));
    }
  }
  const finalMessage = getAppServerFinalMessage(run);
  if (finalMessage && !hasAssistantCompletedEvent(run, finalMessage)) {
    events.push(
      appendEvent(run, {
        phase: "final",
        text: finalMessage,
        type: "assistant.message.completed"
      })
    );
  }
  const status = mapTurnStatus(turn?.status, turn?.error);
  const partial: Partial<RunResult> = {
    status
  };
  if (finalMessage) {
    partial.finalMessage = finalMessage;
  }
  if (run.native.usage) {
    partial.usage = run.native.usage;
  }
  if (run.native.diff) {
    partial.diff = run.native.diff;
  }
  run.native.result = partial;
  run.native.finalResult = synthesizeCodexTurnFromAppServerEvents(run);
  events.push(createAppServerRunCompletedEvent(run, status, finalMessage, partial));
  run.native.completed = true;
  return events;
}

function mapTurnDiffUpdated(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const diff = stringAt(params, "diff");
  if (!diff) {
    return [];
  }
  run.native.diff = diff;
  return [
    appendEvent(run, {
      type: "diff.updated",
      unifiedDiff: diff
    })
  ];
}

function mapTurnPlanUpdated(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const plan = arrayAt(params, "plan");
  if (!plan) {
    return [];
  }
  return [
    appendEvent(run, {
      ...(typeof params.explanation === "string"
        ? { explanation: params.explanation }
        : {}),
      steps: plan.filter(isRecord).map((step) => ({
        status: mapPlanStatus(stringAt(step, "status")),
        step: stringAt(step, "step") ?? ""
      })),
      type: "plan.updated"
    })
  ];
}

function mapThreadTokenUsage(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const tokenUsage = recordAt(params, "tokenUsage") as
    | CodexAppServerThreadTokenUsageLike
    | undefined;
  const usage = mapAppServerUsage(tokenUsage?.total ?? tokenUsage?.last);
  if (!usage) {
    return [];
  }
  run.native.usage = usage;
  return [
    appendEvent(run, {
      type: "usage.updated",
      usage
    })
  ];
}

function mapItemEvent(
  run: CodexAppServerRunHandle,
  providerEventType: "item.started" | "item.completed",
  item: CodexAppServerThreadItemLike | Record<string, unknown> | undefined
): PortableRunEvent[] {
  if (!item || typeof item.type !== "string") {
    return [];
  }
  switch (item.type) {
    case "agentMessage":
      return mapAgentMessageItem(
        run,
        providerEventType,
        item as CodexAppServerAgentMessageItemLike
      );
    case "reasoning":
      return mapReasoningItem(run, item as CodexAppServerReasoningItemLike);
    case "plan":
      return mapPlanItem(run, item as Record<string, unknown>);
    case "commandExecution":
      return mapCommandExecutionItem(
        run,
        providerEventType,
        item as CodexAppServerCommandExecutionItemLike
      );
    case "fileChange":
      return mapFileChangeItem(
        run,
        providerEventType,
        item as CodexAppServerFileChangeItemLike
      );
    case "mcpToolCall":
      return mapMcpToolItem(
        run,
        providerEventType,
        item as CodexAppServerMcpToolCallItemLike
      );
    case "dynamicToolCall":
      return mapDynamicToolItem(
        run,
        providerEventType,
        item as CodexAppServerDynamicToolCallItemLike
      );
    case "webSearch":
      return mapWebSearchItem(
        run,
        providerEventType,
        item as CodexAppServerWebSearchItemLike
      );
    default:
      return [];
  }
}

function mapAgentMessageItem(
  run: CodexAppServerRunHandle,
  providerEventType: "item.started" | "item.completed",
  item: CodexAppServerAgentMessageItemLike
): PortableRunEvent[] {
  if (!item.text) {
    return [];
  }
  run.native.lastAssistantText = item.text;
  run.native.assistantTextByItem[item.id] = item.text;
  return [
    appendEvent(run, {
      phase: mapMessagePhase(item.phase),
      text: item.text,
      type:
        providerEventType === "item.completed"
          ? "assistant.message.completed"
          : "assistant.message.delta"
    })
  ];
}

function mapAgentMessageDelta(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const itemId = stringAt(params, "itemId");
  const delta = stringAt(params, "delta");
  if (!itemId || !delta) {
    return [];
  }
  const next = `${run.native.assistantTextByItem[itemId] ?? ""}${delta}`;
  run.native.assistantTextByItem[itemId] = next;
  run.native.lastAssistantText = next;
  return [
    appendEvent(run, {
      phase: "commentary",
      text: delta,
      type: "assistant.message.delta"
    })
  ];
}

function mapReasoningItem(
  run: CodexAppServerRunHandle,
  item: CodexAppServerReasoningItemLike
): PortableRunEvent[] {
  const text = [...(item.summary ?? []), ...(item.content ?? [])].join("\n");
  if (!text) {
    return [];
  }
  return [
    appendEvent(run, {
      phase: "commentary",
      text,
      type: "assistant.message.delta"
    })
  ];
}

function mapPlanItem(
  run: CodexAppServerRunHandle,
  item: Record<string, unknown>
): PortableRunEvent[] {
  const text = stringAt(item, "text");
  if (!text) {
    return [];
  }
  return [
    appendEvent(run, {
      steps: [
        {
          status: "pending",
          step: text
        }
      ],
      type: "plan.updated"
    })
  ];
}

function mapPlanDelta(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const delta = stringAt(params, "delta");
  if (!delta) {
    return [];
  }
  return [
    appendEvent(run, {
      phase: "commentary",
      text: delta,
      type: "assistant.message.delta"
    })
  ];
}

function mapCommandExecutionItem(
  run: CodexAppServerRunHandle,
  providerEventType: "item.started" | "item.completed",
  item: CodexAppServerCommandExecutionItemLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  const cwd = item.cwd ?? run.native.cwd;
  if (providerEventType === "item.started") {
    events.push(
      appendEvent(run, {
        command: item.command,
        cwd,
        type: "command.started"
      })
    );
  }
  if (item.aggregatedOutput) {
    events.push(
      appendEvent(run, {
        commandId: item.id,
        stream: "combined",
        text: item.aggregatedOutput,
        type: "command.output.delta"
      })
    );
  }
  if (providerEventType === "item.completed" || item.status !== "inProgress") {
    const finished: Extract<PortableRunEvent, { type: "command.finished" }> = {
      ...baseEvent(run),
      command: item.command,
      cwd,
      type: "command.finished"
    };
    if (typeof item.durationMs === "number") {
      finished.durationMs = item.durationMs;
    }
    if (typeof item.exitCode === "number") {
      finished.exitCode = item.exitCode;
    }
    if (item.aggregatedOutput) {
      finished.outputSummary = item.aggregatedOutput;
    }
    if (item.status === "failed") {
      finished.error = {
        message: `Codex app-server command failed: ${item.command}`
      };
    }
    events.push(recordPreparedEvent(run, finished));
  }
  return events;
}

function mapCommandOutputDelta(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const delta = stringAt(params, "delta");
  if (!delta) {
    return [];
  }
  return [
    appendEvent(run, {
      commandId: stringAt(params, "itemId"),
      stream: "combined",
      text: delta,
      type: "command.output.delta"
    })
  ];
}

function mapFileChangeItem(
  run: CodexAppServerRunHandle,
  providerEventType: "item.started" | "item.completed",
  item: CodexAppServerFileChangeItemLike
): PortableRunEvent[] {
  return item.changes.flatMap((change) => {
    const changeKind = mapFileChangeKind(change.kind);
    if (providerEventType === "item.started") {
      return [
        appendEvent(run, {
          changeKind,
          path: change.path,
          type: "file.change.started"
        })
      ];
    }
    const finished: Extract<PortableRunEvent, { type: "file.change.finished" }> = {
      ...baseEvent(run),
      changeKind,
      path: change.path,
      status: mapFileChangeStatus(item.status),
      type: "file.change.finished"
    };
    if (change.diff) {
      finished.diff = change.diff;
    }
    return [recordPreparedEvent(run, finished)];
  });
}

function mapFileChangeOutputDelta(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const delta = stringAt(params, "delta");
  if (!delta) {
    return [];
  }
  return [
    appendEvent(run, {
      data: {
        itemId: stringAt(params, "itemId")
      },
      text: delta,
      toolCallId: stringAt(params, "itemId"),
      type: "tool.delta"
    })
  ];
}

function mapFileChangePatchUpdated(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const changes = arrayAt(params, "changes")?.filter(isRecord) ?? [];
  return changes.flatMap((change) => {
    const path = stringAt(change, "path");
    if (!path) {
      return [];
    }
    const event: Extract<PortableRunEvent, { type: "file.change.updated" }> = {
      ...baseEvent(run),
      path,
      type: "file.change.updated"
    };
    const diff = stringAt(change, "diff");
    if (diff) {
      event.diff = diff;
    }
    return [recordPreparedEvent(run, event)];
  });
}

function mapMcpToolItem(
  run: CodexAppServerRunHandle,
  providerEventType: "item.started" | "item.completed",
  item: CodexAppServerMcpToolCallItemLike
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

function mapMcpToolProgress(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const message = stringAt(params, "message");
  if (!message) {
    return [];
  }
  return [
    appendEvent(run, {
      text: message,
      toolCallId: stringAt(params, "itemId"),
      type: "tool.delta"
    })
  ];
}

function mapDynamicToolItem(
  run: CodexAppServerRunHandle,
  providerEventType: "item.started" | "item.completed",
  item: CodexAppServerDynamicToolCallItemLike
): PortableRunEvent[] {
  const name = item.namespace ? `${item.namespace}.${item.tool}` : item.tool;
  if (providerEventType === "item.started") {
    return [
      appendEvent(run, {
        input: item.arguments,
        tool: {
          kind: "dynamic",
          name
        },
        type: "tool.started"
      })
    ];
  }
  return [
    appendEvent(run, {
      output: item.contentItems ?? {
        success: item.success
      },
      tool: {
        kind: "dynamic",
        name
      },
      type: "tool.finished"
    })
  ];
}

function mapWebSearchItem(
  run: CodexAppServerRunHandle,
  providerEventType: "item.started" | "item.completed",
  item: CodexAppServerWebSearchItemLike
): PortableRunEvent[] {
  const query = item.query ?? webSearchQuery(item.action);
  const tool = {
    kind: "provider_native" as const,
    name: "web_search"
  };
  if (providerEventType === "item.started") {
    return [
      appendEvent(run, {
        input: {
          action: item.action,
          query
        },
        tool,
        type: "tool.started"
      })
    ];
  }
  return [
    appendEvent(run, {
      output: {
        action: item.action,
        query
      },
      tool,
      type: "tool.finished"
    })
  ];
}

function mapServerRequestResolved(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const requestId = params.requestId;
  if (typeof requestId !== "string" && typeof requestId !== "number") {
    return [];
  }
  return [
    appendEvent(run, {
      approvalId: String(requestId),
      decision: "accept",
      type: "approval.resolved"
    })
  ];
}

function mapErrorNotification(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): PortableRunEvent[] {
  const error = normalizeAppServerError(recordAt(params, "error") ?? params);
  run.native.result = {
    finalMessage: error.message,
    status: "failed"
  };
  return [
    appendEvent(run, {
      error,
      severity: "error",
      type: "error"
    }),
    createAppServerRunCompletedEvent(run, "failed", error.message, {
      finalMessage: error.message,
      status: "failed"
    })
  ];
}

function approvalFromRequest(
  requestId: CodexAppServerJsonRpcId,
  method: string,
  params: Record<string, unknown>
): PortableEventPayload {
  const preview = approvalPreview(method, params);
  return {
    approvalId: String(requestId),
    availableDecisions: availableDecisionsForRequest(method, params),
    category: approvalCategory(method),
    native: {
      method,
      params
    },
    ...(preview ? { preview } : {}),
    reason: stringAt(params, "reason") ?? `Codex app-server requested ${method}.`,
    type: "approval.requested"
  };
}

function approvalPreview(
  method: string,
  params: Record<string, unknown>
): Extract<PortableRunEvent, { type: "approval.requested" }>["preview"] {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "execCommandApproval"
  ) {
    const command = stringAt(params, "command") ?? commandArrayAt(params, "command");
    return {
      ...(command ? { command } : {}),
      ...(typeof params.cwd === "string" ? { cwd: params.cwd } : {})
    };
  }
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    const grantRoot = stringAt(params, "grantRoot");
    return grantRoot
      ? {
          path: grantRoot
        }
      : undefined;
  }
  return undefined;
}

function approvalCategory(
  method: string
): Extract<PortableRunEvent, { type: "approval.requested" }>["category"] {
  if (
    method === "item/commandExecution/requestApproval" ||
    method === "execCommandApproval"
  ) {
    return "command";
  }
  if (method === "item/fileChange/requestApproval" || method === "applyPatchApproval") {
    return "file_change";
  }
  if (method === "mcpServer/elicitation/request") {
    return "mcp_tool";
  }
  return "provider_native";
}

function availableDecisionsForRequest(
  method: string,
  params: Record<string, unknown>
): Extract<PortableRunEvent, { type: "approval.requested" }>["availableDecisions"] {
  const providerDecisions = arrayAt(params, "availableDecisions");
  const mapped = providerDecisions
    ?.map((decision) =>
      typeof decision === "string" ? mapApprovalDecision(decision) : undefined
    )
    .filter((decision): decision is NonNullable<typeof decision> => Boolean(decision));
  if (mapped && mapped.length > 0) {
    return mapped;
  }
  if (method === "item/tool/requestUserInput") {
    return ["cancel"];
  }
  return ["accept", "accept_for_session", "decline", "cancel"];
}

function mapApprovalDecision(
  decision: string
):
  | Extract<
      PortableRunEvent,
      { type: "approval.requested" }
    >["availableDecisions"][number]
  | undefined {
  switch (decision) {
    case "accept":
    case "approved":
      return "accept";
    case "acceptForSession":
    case "approved_for_session":
      return "accept_for_session";
    case "decline":
    case "denied":
      return "decline";
    case "cancel":
    case "abort":
      return "cancel";
    default:
      return undefined;
  }
}

function mapAppServerUsage(
  usage: CodexAppServerUsageBreakdownLike | undefined
): NonNullable<RunResult["usage"]> | undefined {
  if (!usage) {
    return undefined;
  }
  const mapped: NonNullable<RunResult["usage"]> = {};
  if (typeof usage.inputTokens === "number") {
    mapped.inputTokens = usage.inputTokens;
  }
  if (typeof usage.cachedInputTokens === "number") {
    mapped.cacheReadTokens = usage.cachedInputTokens;
  }
  const outputTokens =
    typeof usage.outputTokens === "number" ||
    typeof usage.reasoningOutputTokens === "number"
      ? (usage.outputTokens ?? 0) + (usage.reasoningOutputTokens ?? 0)
      : undefined;
  if (typeof outputTokens === "number") {
    mapped.outputTokens = outputTokens;
  }
  if (typeof usage.totalTokens === "number") {
    mapped.totalTokens = usage.totalTokens;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
}

function mapTurnStatus(
  status: CodexAppServerTurnLike["status"],
  error: CodexAppServerTurnLike["error"]
): RunResult["status"] {
  if (status === "interrupted") {
    return "cancelled";
  }
  if (status === "failed" || error) {
    return "failed";
  }
  return "success";
}

function mapPlanStatus(
  status: string | undefined
): Extract<PortableRunEvent, { type: "plan.updated" }>["steps"][number]["status"] {
  switch (status) {
    case "inProgress":
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
      return "failed";
    case "pending":
    default:
      return "pending";
  }
}

function mapFileChangeStatus(
  status: CodexAppServerFileChangeItemLike["status"]
): Extract<PortableRunEvent, { type: "file.change.finished" }>["status"] {
  if (status === "completed") {
    return "completed";
  }
  if (status === "declined") {
    return "declined";
  }
  return "failed";
}

function mapFileChangeKind(
  kind: CodexAppServerFileUpdateChangeLike["kind"]
): FileChangeKind {
  if (kind === "add") {
    return "create";
  }
  if (kind === "delete") {
    return "delete";
  }
  if (kind === "update") {
    return "modify";
  }
  return "unknown";
}

function mapMessagePhase(
  phase: CodexAppServerAgentMessageItemLike["phase"]
): Extract<PortableRunEvent, { type: "assistant.message.delta" }>["phase"] {
  if (phase === "final_answer") {
    return "final";
  }
  if (phase === "commentary") {
    return "commentary";
  }
  return "unknown";
}

function captureThreadId(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): void {
  const thread = recordAt(params, "thread");
  const threadId = stringAt(thread, "id") ?? stringAt(params, "threadId");
  if (threadId) {
    run.native.threadId = threadId;
    run.nativeSessionId = threadId;
  }
}

function captureTurnId(
  run: CodexAppServerRunHandle,
  params: Record<string, unknown>
): void {
  const turn = recordAt(params, "turn");
  const turnId = stringAt(turn, "id") ?? stringAt(params, "turnId");
  if (turnId) {
    run.native.turnId = turnId;
    run.nativeRunId = turnId;
  }
}

function getAppServerFinalMessage(run: CodexAppServerRunHandle): string | undefined {
  const completed = [...run.native.events]
    .reverse()
    .find((event) => event.type === "assistant.message.completed");
  if (completed?.type === "assistant.message.completed" && completed.text) {
    return completed.text;
  }
  return run.native.lastAssistantText;
}

function hasAssistantCompletedEvent(run: CodexAppServerRunHandle, text: string): boolean {
  return run.native.events.some(
    (event) => event.type === "assistant.message.completed" && event.text === text
  );
}

function baseEvent(run: CodexAppServerRunHandle): CodexEventBase {
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

function appendEvent(
  run: CodexAppServerRunHandle,
  event: PortableEventPayload
): PortableRunEvent {
  return recordPreparedEvent(run, {
    ...baseEvent(run),
    ...event
  } as PortableRunEvent);
}

function recordPreparedEvent<TEvent extends PortableRunEvent>(
  run: CodexAppServerRunHandle,
  event: TEvent
): TEvent {
  run.native.seq = event.seq;
  run.native.events.push(event);
  return event;
}

function webSearchQuery(action: unknown): string | undefined {
  const record = asRecord(action);
  const query = stringAt(record, "query");
  if (query) {
    return query;
  }
  const queries = arrayAt(record, "queries");
  const first = queries?.find((item) => typeof item === "string");
  return typeof first === "string" ? first : undefined;
}

function commandArrayAt(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return Array.isArray(candidate) && candidate.every((item) => typeof item === "string")
    ? candidate.join(" ")
    : undefined;
}

function recordAt(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const candidate = value?.[key];
  return isRecord(candidate) ? candidate : undefined;
}

function stringAt(
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function arrayAt(
  value: Record<string, unknown> | undefined,
  key: string
): unknown[] | undefined {
  const candidate = value?.[key];
  return Array.isArray(candidate) ? candidate : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function providerEventType(message: CodexAppServerInboundMessage): string {
  return message.method;
}
