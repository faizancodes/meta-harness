import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  capability,
  createHarness,
  createRunId,
  createSessionId,
  hashTask,
  nowIso
} from "../src/index.js";
import type {
  CodingAgentAdapter,
  PortableRunEvent,
  ProviderCapabilities,
  ResumeSessionConfig,
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle,
  StartSessionConfig
} from "../src/index.js";

describe("run limits", () => {
  it("fails the portable run result when observable limits are exceeded", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-limits-"));
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd
        }
      },
      [new LimitAdapter()]
    );

    const result = await harness.run({
      limits: {
        maxCostUsd: 0.01,
        maxDiffBytes: 8,
        maxDurationMs: 1,
        maxFilesChanged: 0
      },
      task: "exercise limits"
    });

    expect(result.status).toBe("failed");
    expect(result.finalMessage).toContain("Run exceeded configured metaharness limits");

    const ledger = await harness.exportLedger(result.runId);
    expect(ledger.summary.failureReason).toBe(result.finalMessage);
    expect(ledger.events.counts.error).toBe(1);
    expect(ledger.events.counts["run.completed"]).toBe(2);

    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PortableRunEvent);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.at(-1)).toMatchObject({
      status: "failed",
      type: "run.completed"
    });

    const errorEvent = events.find((event) => event.type === "error");
    if (!errorEvent || errorEvent.type !== "error") {
      throw new Error("Expected a limit error event.");
    }
    expect(errorEvent.error.code).toBe("RUN_LIMIT_EXCEEDED");
    const cause = errorEvent.error.cause as {
      violations: Array<{ limit: string }>;
    };
    expect(cause.violations.map((violation) => violation.limit)).toEqual(
      expect.arrayContaining([
        "maxCostUsd",
        "maxDiffBytes",
        "maxDurationMs",
        "maxFilesChanged"
      ])
    );
  });

  it("enforces observable limits loaded from configured policy files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-policy-limits-"));
    await writeFile(
      join(cwd, "metaharness.policy.yaml"),
      `version: 1
limits:
  maxCostUsd: 0.01
  maxDiffBytes: 8
`,
      "utf8"
    );
    const harness = createHarness(
      {
        defaultProvider: "mock",
        policy: {
          file: "metaharness.policy.yaml"
        },
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd
        }
      },
      [new LimitAdapter()]
    );

    const result = await harness.run({
      task: "exercise policy file limits"
    });

    expect(result.status).toBe("failed");
    expect(result.finalMessage).toContain("Run exceeded configured metaharness limits");

    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PortableRunEvent);
    const errorEvent = events.find((event) => event.type === "error");
    if (!errorEvent || errorEvent.type !== "error") {
      throw new Error("Expected a limit error event.");
    }
    const cause = errorEvent.error.cause as {
      violations: Array<{ limit: string }>;
    };
    expect(cause.violations.map((violation) => violation.limit)).toEqual(
      expect.arrayContaining(["maxCostUsd", "maxDiffBytes"])
    );
  });

  it("enforces maxTurns from observable assistant completed messages", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-turn-limits-"));
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd
        }
      },
      [new TurnLimitAdapter()]
    );

    const result = await harness.run({
      limits: {
        maxTurns: 1
      },
      task: "exercise turn limits"
    });

    expect(result.status).toBe("failed");
    expect(result.finalMessage).toContain("maxTurns 2 turns exceeded 1 turns");

    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PortableRunEvent);
    const errorEvent = events.find((event) => event.type === "error");
    if (!errorEvent || errorEvent.type !== "error") {
      throw new Error("Expected a limit error event.");
    }
    const cause = errorEvent.error.cause as {
      violations: Array<{ actual: number; limit: string; max: number; unit: string }>;
    };
    expect(cause.violations).toContainEqual({
      actual: 2,
      limit: "maxTurns",
      max: 1,
      unit: "turns"
    });
  });
});

interface LimitSession {
  cwd: string;
}

interface LimitRun {
  diff: string;
  events: PortableRunEvent[];
  finalMessage: string;
}

class LimitAdapter implements CodingAgentAdapter<LimitSession, LimitRun> {
  readonly provider = "mock" as const;
  readonly version = "test";

  async capabilities(): Promise<ProviderCapabilities> {
    const yes = () => capability(true, "stable");
    const no = () => capability(false, "unknown");
    return {
      knownLimitations: [],
      lifecycle: {
        cancel: no(),
        fork: no(),
        resume: yes(),
        start: yes(),
        stream: yes(),
        wait: yes()
      },
      observability: {
        commandEvents: no(),
        cost: yes(),
        diffEvents: no(),
        fileChangeEvents: yes(),
        planEvents: no(),
        rawEventAccess: no(),
        tokenUsage: yes(),
        toolCallEvents: no()
      },
      policy: {
        commandAllowDeny: no(),
        filesystemSandbox: no(),
        humanApprovals: no(),
        networkControl: no(),
        providerNativePermissions: no()
      },
      provider: "mock",
      runtime: {
        cloud: no(),
        local: yes(),
        selfHosted: no()
      },
      tools: {
        hooks: no(),
        mcp: no(),
        skills: no(),
        subagents: no(),
        webSearch: no()
      },
      workspace: {
        artifacts: yes(),
        gitBranch: no(),
        gitDiff: no(),
        openPullRequest: no(),
        readFiles: no(),
        runCommands: no(),
        writeFiles: yes()
      }
    };
  }

  async startSession(config: StartSessionConfig): Promise<SessionHandle<LimitSession>> {
    return {
      createdAt: nowIso(),
      cwd: config.workspace.cwd,
      native: {
        cwd: config.workspace.cwd
      },
      provider: "mock",
      sessionId: createSessionId("mock")
    };
  }

  async resumeSession(config: ResumeSessionConfig): Promise<SessionHandle<LimitSession>> {
    return this.startSession(config);
  }

  async run(
    session: SessionHandle<LimitSession>,
    input: RunInput
  ): Promise<RunHandle<LimitRun>> {
    const runId = createRunId("mock");
    const finalMessage = `Limit adapter completed: ${input.task}`;
    const diff = [
      "diff --git a/LIMIT.md b/LIMIT.md",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/LIMIT.md",
      "@@ -0,0 +1 @@",
      `+${finalMessage}`
    ].join("\n");
    const base = {
      provider: "mock" as const,
      runId,
      sessionId: session.sessionId
    };
    return {
      native: {
        diff,
        events: [
          {
            ...base,
            id: `${runId}-event-000001`,
            input: {
              cwd: session.native.cwd,
              mode: input.mode ?? "edit",
              taskHash: hashTask(input.task)
            },
            seq: 1,
            ts: "2026-01-01T00:00:00.000Z",
            type: "run.started"
          },
          {
            ...base,
            changeKind: "create",
            diff,
            id: `${runId}-event-000002`,
            path: "LIMIT.md",
            seq: 2,
            status: "completed",
            ts: "2026-01-01T00:00:01.000Z",
            type: "file.change.finished"
          },
          {
            ...base,
            finalMessage,
            id: `${runId}-event-000003`,
            result: {
              finalMessage,
              status: "success"
            },
            seq: 3,
            status: "success",
            ts: "2026-01-01T00:00:02.000Z",
            type: "run.completed"
          }
        ],
        finalMessage
      },
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      startedAt: "2026-01-01T00:00:00.000Z"
    };
  }

  async *stream(run: RunHandle<LimitRun>): AsyncIterable<PortableRunEvent> {
    for (const event of run.native.events) {
      yield event;
    }
  }

  async wait(run: RunHandle<LimitRun>): Promise<RunResult> {
    await delay(25);
    return {
      artifacts: [
        {
          kind: "patch",
          name: "limit-diff.patch"
        }
      ],
      diff: run.native.diff,
      finalMessage: run.native.finalMessage,
      provider: "mock",
      runId: run.runId,
      sessionId: run.sessionId,
      status: "success",
      usage: {
        estimatedCostUsd: 0.25,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    };
  }

  async cancel(): Promise<void> {
    return Promise.resolve();
  }
}

class TurnLimitAdapter extends LimitAdapter {
  override async run(
    session: SessionHandle<LimitSession>,
    input: RunInput
  ): Promise<RunHandle<LimitRun>> {
    const run = await super.run(session, input);
    const [started, fileChange, completed] = run.native.events;
    if (!started || !fileChange || !completed) {
      return run;
    }
    const base = {
      provider: "mock" as const,
      runId: run.runId,
      sessionId: run.sessionId
    };
    run.native.events = [
      started,
      {
        ...base,
        id: `${run.runId}-event-000002`,
        phase: "commentary",
        seq: 2,
        text: "First assistant turn.",
        ts: "2026-01-01T00:00:00.500Z",
        type: "assistant.message.completed"
      },
      {
        ...base,
        id: `${run.runId}-event-000003`,
        phase: "commentary",
        seq: 3,
        text: "Second assistant turn.",
        ts: "2026-01-01T00:00:00.750Z",
        type: "assistant.message.completed"
      },
      {
        ...fileChange,
        id: `${run.runId}-event-000004`,
        seq: 4,
        ts: "2026-01-01T00:00:01.000Z"
      },
      {
        ...completed,
        id: `${run.runId}-event-000005`,
        seq: 5,
        ts: "2026-01-01T00:00:02.000Z"
      }
    ];
    return run;
  }
}
