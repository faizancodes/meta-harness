import { createEventId, hashTask, nowIso } from "@metaharness/core";
import type {
  CursorArtifactLike,
  CursorAssistantMessageLike,
  CursorContentBlockLike,
  CursorRunHandle,
  CursorRunResultLike,
  CursorSdkMessageLike,
  CursorStatusMessageLike,
  CursorTaskMessageLike,
  CursorThinkingMessageLike,
  CursorToolUseMessageLike
} from "./types.js";
import type {
  Artifact,
  BaseEvent,
  NormalizedError,
  PortableRunEvent,
  RunResult
} from "@metaharness/core";

type CursorEventBase = Omit<BaseEvent, "provider"> & {
  provider: "cursor";
};

type PortableEventPayload = {
  severity?: BaseEvent["severity"];
  type: PortableRunEvent["type"];
  [key: string]: unknown;
};

export function createRunStartedEvent(run: CursorRunHandle): PortableRunEvent {
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
  run: CursorRunHandle,
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
  run: CursorRunHandle,
  raw: unknown,
  providerEventType?: string
): PortableRunEvent {
  return appendEvent(run, {
    ...(providerEventType ? { providerEventType } : {}),
    raw,
    type: "provider.raw"
  });
}

export function createErrorEvent(run: CursorRunHandle, error: unknown): PortableRunEvent {
  return appendEvent(run, {
    error: normalizeError(error),
    severity: "error",
    type: "error"
  });
}

export function createRunCompletedEvent(
  run: CursorRunHandle,
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

export function mapCursorEvent(
  run: CursorRunHandle,
  event: CursorSdkMessageLike
): PortableRunEvent[] {
  captureNativeIds(run, event);
  switch (event.type) {
    case "assistant":
      return mapAssistantEvent(run, event as CursorAssistantMessageLike);
    case "thinking":
      return mapThinkingEvent(run, event as CursorThinkingMessageLike);
    case "tool_call":
      return mapToolCallEvent(run, event as CursorToolUseMessageLike);
    case "status":
      return [mapStatusEvent(run, event as CursorStatusMessageLike)];
    case "request":
      return [
        appendEvent(run, {
          approvalId: event.request_id ?? `${run.runId}-request-${run.native.seq + 1}`,
          availableDecisions: ["accept", "decline", "cancel"],
          category: "provider_native",
          native: event,
          reason: "Cursor SDK emitted a request event.",
          type: "approval.requested"
        })
      ];
    case "task":
      return mapTaskEvent(run, event as CursorTaskMessageLike);
    default:
      return [];
  }
}

export function mapCursorResultToRunResult(
  run: CursorRunHandle,
  resultInput?: CursorRunResultLike
): RunResult {
  const result = resultInput ?? run.native.finalResult ?? runResultFromNativeRun(run);
  const status = mapRunResultStatus(result.status ?? run.native.run.status);
  const artifacts = artifactsFromResult(result);
  const mapped: RunResult = {
    artifacts,
    native: {
      agentId: run.native.agentId,
      result,
      runtime: run.native.runtime,
      run: run.native.run
    },
    provider: "cursor",
    runId: run.runId,
    sessionId: run.sessionId,
    status
  };
  const nativeRunId = result.id ?? run.native.run.id;
  if (nativeRunId) {
    mapped.nativeRunId = nativeRunId;
  }
  if (run.nativeSessionId) {
    mapped.nativeSessionId = run.nativeSessionId;
  }
  if (result.result) {
    mapped.finalMessage = result.result;
  }
  const firstPr = result.git?.branches?.find((branch) => branch.prUrl)?.prUrl;
  if (firstPr) {
    mapped.providerRunUrl = firstPr;
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
    message: "Unknown Cursor SDK error."
  };
}

function mapAssistantEvent(
  run: CursorRunHandle,
  event: CursorAssistantMessageLike
): PortableRunEvent[] {
  const events: PortableRunEvent[] = [];
  for (const block of contentBlocks(event.message?.content)) {
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      events.push(
        appendEvent(run, {
          phase: "commentary",
          text: block.text,
          type: "assistant.message.completed"
        })
      );
    }
    if (block.type === "tool_use" && typeof block.name === "string") {
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
  return events;
}

function mapThinkingEvent(
  run: CursorRunHandle,
  event: CursorThinkingMessageLike
): PortableRunEvent[] {
  if (!event.text) {
    return [];
  }
  return [
    appendEvent(run, {
      phase: "commentary",
      text: event.text,
      type: "assistant.message.delta"
    })
  ];
}

function mapToolCallEvent(
  run: CursorRunHandle,
  event: CursorToolUseMessageLike
): PortableRunEvent[] {
  const tool = {
    kind: toolKind(event.name ?? "unknown"),
    name: event.name ?? "unknown"
  };
  if (event.status === "running") {
    return [
      appendEvent(run, {
        input: event.args,
        tool,
        type: "tool.started"
      })
    ];
  }
  return [
    appendEvent(run, {
      ...(event.status === "error"
        ? {
            error: {
              message: stringify(event.result ?? "Cursor tool call failed.")
            }
          }
        : { output: event.result }),
      tool,
      type: "tool.finished"
    })
  ];
}

function mapStatusEvent(
  run: CursorRunHandle,
  event: CursorStatusMessageLike
): PortableRunEvent {
  return createRunStatusEvent(run, mapCursorStatus(event.status), event.message);
}

function mapTaskEvent(
  run: CursorRunHandle,
  event: CursorTaskMessageLike
): PortableRunEvent[] {
  if (!event.text) {
    return [
      createRunStatusEvent(
        run,
        "running",
        event.status ? `Cursor task ${event.status}` : "Cursor task update."
      )
    ];
  }
  return [
    appendEvent(run, {
      explanation: event.status,
      steps: [
        {
          status: mapTaskStatus(event.status),
          step: event.text
        }
      ],
      type: "plan.updated"
    })
  ];
}

function mapCursorStatus(
  status: CursorStatusMessageLike["status"]
): Extract<PortableRunEvent, { type: "run.status" }>["status"] {
  switch (status) {
    case "CREATING":
      return "starting";
    case "RUNNING":
      return "running";
    case "FINISHED":
      return "completed";
    case "ERROR":
    case "EXPIRED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    default:
      return "running";
  }
}

function mapRunResultStatus(status: unknown): RunResult["status"] {
  switch (status) {
    case "finished":
      return "success";
    case "cancelled":
      return "cancelled";
    case "error":
    default:
      return "failed";
  }
}

function mapTaskStatus(
  status: string | undefined
): Extract<PortableRunEvent, { type: "plan.updated" }>["steps"][number]["status"] {
  switch (status) {
    case "completed":
    case "finished":
    case "FINISHED":
      return "completed";
    case "error":
    case "failed":
    case "ERROR":
      return "failed";
    case "running":
    case "RUNNING":
      return "in_progress";
    default:
      return "pending";
  }
}

function artifactsFromResult(result: CursorRunResultLike): Artifact[] {
  const artifacts: Artifact[] = [];
  for (const branch of result.git?.branches ?? []) {
    if (branch.branch) {
      artifacts.push({
        kind: "branch",
        name: branch.branch,
        metadata: {
          repoUrl: branch.repoUrl
        }
      });
    }
    if (branch.prUrl) {
      artifacts.push({
        kind: "pull_request",
        url: branch.prUrl,
        metadata: {
          branch: branch.branch,
          repoUrl: branch.repoUrl
        }
      });
    }
  }
  return artifacts;
}

export function artifactsFromCursorArtifacts(
  artifacts: CursorArtifactLike[]
): Artifact[] {
  return artifacts.map((artifact) => {
    const mapped: Artifact = {
      kind: artifact.url ? "url" : "file",
      metadata: artifact
    };
    if (artifact.name) {
      mapped.name = artifact.name;
    }
    if (artifact.path) {
      mapped.path = artifact.path;
    }
    if (artifact.url) {
      mapped.url = artifact.url;
    }
    return mapped;
  });
}

function runResultFromNativeRun(run: CursorRunHandle): CursorRunResultLike {
  const result: CursorRunResultLike = {};
  if (typeof run.native.run.durationMs === "number") {
    result.durationMs = run.native.run.durationMs;
  }
  if (run.native.run.git) {
    result.git = run.native.run.git;
  }
  if (run.native.run.id) {
    result.id = run.native.run.id;
  }
  if (run.native.run.model) {
    result.model = run.native.run.model;
  }
  if (run.native.run.result) {
    result.result = run.native.run.result;
  }
  if (run.native.run.status) {
    result.status = run.native.run.status;
  }
  return result;
}

function captureNativeIds(run: CursorRunHandle, event: CursorSdkMessageLike): void {
  if ("agent_id" in event && typeof event.agent_id === "string") {
    run.nativeSessionId = event.agent_id;
  }
  if ("run_id" in event && typeof event.run_id === "string") {
    run.nativeRunId = event.run_id;
  }
}

function contentBlocks(value: unknown): CursorContentBlockLike[] {
  return Array.isArray(value)
    ? value.filter((item): item is CursorContentBlockLike => isRecord(item))
    : [];
}

function toolKind(
  name: string
): Extract<PortableRunEvent, { type: "tool.started" }>["tool"]["kind"] {
  return name.startsWith("mcp__") ? "mcp" : "provider_native";
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "Cursor SDK value could not be serialized.";
  }
}

function baseEvent(run: CursorRunHandle): CursorEventBase {
  const seq = run.native.seq + 1;
  return {
    id: createEventId(run.runId, seq),
    provider: "cursor",
    runId: run.runId,
    seq,
    sessionId: run.sessionId,
    ts: nowIso()
  };
}

function appendEvent(
  run: CursorRunHandle,
  event: PortableEventPayload
): PortableRunEvent {
  return recordPreparedEvent(run, {
    ...baseEvent(run),
    ...event
  } as PortableRunEvent);
}

function recordPreparedEvent<TEvent extends PortableRunEvent>(
  run: CursorRunHandle,
  event: TEvent
): TEvent {
  run.native.seq = event.seq;
  run.native.events.push(event);
  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
