import { createHash } from "node:crypto";
import type { PortableRunEvent } from "@metaharness/core";
import type { RunInput, SessionHandle } from "@metaharness/core";

export interface MockRunScript {
  cancelled: boolean;
  completed: boolean;
  events: PortableRunEvent[];
  eventDelayMs: number;
  finalMessage: string;
  diff: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export function createMockRunScript(
  session: SessionHandle,
  runId: string,
  input: RunInput
): MockRunScript {
  const base = {
    provider: "mock" as const,
    runId,
    sessionId: session.sessionId
  };
  const cwd = input.workspace?.cwd ?? session.cwd ?? ".";
  const finalMessage = `Mock completed: ${input.task}`;
  const diff = [
    "diff --git a/MOCK.md b/MOCK.md",
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    "+++ b/MOCK.md",
    "@@ -0,0 +1 @@",
    `+${finalMessage}`
  ].join("\n");
  const usage = {
    inputTokens: countWords(input.task),
    outputTokens: countWords(finalMessage),
    totalTokens: countWords(input.task) + countWords(finalMessage)
  };
  const eventDelayMs = mockNativeNumber(input.native, "eventDelayMs");
  const events: PortableRunEvent[] = [
    {
      ...base,
      id: eventId(runId, 1),
      input: {
        cwd,
        mode: input.mode ?? "edit",
        taskHash: createHash("sha256").update(input.task).digest("hex")
      },
      seq: 1,
      ts: ts(1),
      type: "run.started"
    },
    {
      ...base,
      id: eventId(runId, 2),
      phase: "commentary",
      seq: 2,
      text: "Mock adapter is processing the task.",
      ts: ts(2),
      type: "assistant.message.delta"
    },
    {
      ...base,
      id: eventId(runId, 3),
      phase: "commentary",
      seq: 3,
      text: "Mock adapter is processing the task.",
      ts: ts(3),
      type: "assistant.message.completed"
    },
    {
      ...base,
      explanation: "Deterministic mock plan.",
      id: eventId(runId, 4),
      seq: 4,
      steps: [
        {
          status: "completed",
          step: "Record the requested task"
        },
        {
          status: "completed",
          step: "Emit deterministic portable events"
        }
      ],
      ts: ts(4),
      type: "plan.updated"
    },
    {
      ...base,
      command: "mock verify",
      cwd,
      id: eventId(runId, 5),
      reason: "Demonstrate command event capture without running a shell command.",
      seq: 5,
      ts: ts(5),
      type: "command.started"
    },
    {
      ...base,
      command: "mock verify",
      cwd,
      durationMs: 1,
      exitCode: 0,
      id: eventId(runId, 6),
      outputSummary: "Mock verification passed.",
      seq: 6,
      ts: ts(6),
      type: "command.finished"
    },
    {
      ...base,
      changeKind: "create",
      diff,
      id: eventId(runId, 7),
      path: "MOCK.md",
      seq: 7,
      status: "completed",
      ts: ts(7),
      type: "file.change.finished"
    },
    {
      ...base,
      id: eventId(runId, 8),
      seq: 8,
      ts: ts(8),
      type: "diff.updated",
      unifiedDiff: diff
    },
    {
      ...base,
      id: eventId(runId, 9),
      seq: 9,
      ts: ts(9),
      type: "usage.updated",
      usage
    },
    {
      ...base,
      finalMessage,
      id: eventId(runId, 10),
      result: {
        finalMessage,
        status: "success"
      },
      seq: 10,
      status: "success",
      ts: ts(10),
      type: "run.completed"
    }
  ];
  return {
    cancelled: false,
    completed: false,
    diff,
    events,
    eventDelayMs,
    finalMessage,
    usage
  };
}

function eventId(runId: string, seq: number): string {
  return `${runId}-event-${String(seq).padStart(6, "0")}`;
}

function ts(seq: number): string {
  return new Date(seq * 1000).toISOString();
}

function countWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function mockNativeNumber(
  native: Record<string, unknown> | undefined,
  key: string
): number {
  const scoped = isRecord(native?.mock) ? native.mock : native;
  const value = scoped?.[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
