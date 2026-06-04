import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("observable command policy guard", () => {
  it("fails the run when provider command events violate configured policy", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-command-denied-"));
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
      [new ObservableCommandAdapter("npm install evil")]
    );

    const result = await harness.run({
      policy: {
        inline: {
          commands: {
            allow: ["npm test"],
            default: "deny",
            deny: ["npm install *"]
          },
          version: 1
        }
      },
      task: "observe denied command"
    });

    expect(result.status).toBe("failed");
    expect(result.finalMessage).toContain("violated metaharness command policy");

    const ledger = await harness.exportLedger(result.runId);
    expect(ledger.summary.failureReason).toBe(result.finalMessage);
    expect(ledger.events.counts.error).toBe(1);
    expect(ledger.commands).toEqual([
      expect.objectContaining({
        command: "npm install evil",
        exitCode: 0
      })
    ]);

    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PortableRunEvent);
    const errorEvent = events.find((event) => event.type === "error");
    if (!errorEvent || errorEvent.type !== "error") {
      throw new Error("Expected a command policy error event.");
    }
    expect(errorEvent.error.code).toBe("COMMAND_POLICY_VIOLATION");
    expect(errorEvent.error.cause).toMatchObject({
      violation: {
        command: "npm install evil",
        matchedRule: "npm install *"
      }
    });
    expect(events.at(-1)).toMatchObject({
      status: "failed",
      type: "run.completed"
    });
  });

  it("keeps the run successful when observed commands are explicitly allowed", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-command-allowed-"));
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
      [new ObservableCommandAdapter("npm test -- --runInBand")]
    );

    const result = await harness.run({
      policy: {
        inline: {
          commands: {
            allow: ["npm test *"],
            default: "deny",
            deny: []
          },
          version: 1
        }
      },
      task: "observe allowed command"
    });

    expect(result.status).toBe("success");
    expect(result.finalMessage).toBe("command adapter completed");
    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PortableRunEvent);
    expect(events.filter((event) => event.type === "error")).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      status: "success",
      type: "run.completed"
    });
  });
});

interface ObservableCommandSession {
  cwd: string;
}

interface ObservableCommandRun {
  command: string;
  events: PortableRunEvent[];
}

class ObservableCommandAdapter implements CodingAgentAdapter<
  ObservableCommandSession,
  ObservableCommandRun
> {
  readonly provider = "mock" as const;
  readonly version = "test";

  constructor(private readonly command: string) {}

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
        commandEvents: yes(),
        cost: no(),
        diffEvents: no(),
        fileChangeEvents: no(),
        planEvents: no(),
        rawEventAccess: no(),
        tokenUsage: no(),
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
        artifacts: no(),
        gitBranch: no(),
        gitDiff: no(),
        openPullRequest: no(),
        readFiles: no(),
        runCommands: yes(),
        writeFiles: no()
      }
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<ObservableCommandSession>> {
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

  async resumeSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<ObservableCommandSession>> {
    return this.startSession(config);
  }

  async run(
    session: SessionHandle<ObservableCommandSession>,
    input: RunInput
  ): Promise<RunHandle<ObservableCommandRun>> {
    const runId = createRunId("mock");
    const base = {
      provider: "mock" as const,
      runId,
      sessionId: session.sessionId
    };
    const events: PortableRunEvent[] = [
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
        command: this.command,
        cwd: session.native.cwd,
        id: `${runId}-event-000002`,
        seq: 2,
        ts: "2026-01-01T00:00:01.000Z",
        type: "command.started"
      },
      {
        ...base,
        command: this.command,
        cwd: session.native.cwd,
        exitCode: 0,
        id: `${runId}-event-000003`,
        outputSummary: "command completed",
        seq: 3,
        ts: "2026-01-01T00:00:02.000Z",
        type: "command.finished"
      },
      {
        ...base,
        finalMessage: "command adapter completed",
        id: `${runId}-event-000004`,
        result: {
          finalMessage: "command adapter completed",
          status: "success"
        },
        seq: 4,
        status: "success",
        ts: "2026-01-01T00:00:03.000Z",
        type: "run.completed"
      }
    ];
    return {
      native: {
        command: this.command,
        events
      },
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      startedAt: "2026-01-01T00:00:00.000Z"
    };
  }

  async *stream(run: RunHandle<ObservableCommandRun>): AsyncIterable<PortableRunEvent> {
    for (const event of run.native.events) {
      yield event;
    }
  }

  async wait(run: RunHandle<ObservableCommandRun>): Promise<RunResult> {
    return {
      artifacts: [],
      finalMessage: "command adapter completed",
      provider: "mock",
      runId: run.runId,
      sessionId: run.sessionId,
      status: "success"
    };
  }

  async cancel(): Promise<void> {
    return Promise.resolve();
  }
}
