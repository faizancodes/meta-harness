import { mkdtemp, writeFile } from "node:fs/promises";
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
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle,
  StartSessionConfig
} from "../src/index.js";

describe("harness policy API", () => {
  it("checks configured policy files and inline policies through the policy package", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-policy-api-"));
    const harness = createHarness({
      workspace: {
        cwd
      }
    });

    const missing = await harness.policy.check();
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toEqual(
      expect.objectContaining({
        code: "POLICY_FILE_NOT_FOUND"
      })
    );

    const inline = await harness.policy.check({
      inline: {
        version: 1
      },
      provider: "mock"
    });
    expect(inline.ok).toBe(true);
    expect(inline.providerWarnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "PROVIDER_POLICY_MOCK_SYNTHETIC",
          provider: "mock"
        })
      ])
    );

    await writeFile(
      join(cwd, "metaharness.policy.yaml"),
      `version: 1
filesystem:
  mode: danger
`,
      "utf8"
    );
    const invalid = await harness.policy.check({
      file: "metaharness.policy.yaml"
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.errors[0]).toEqual(
      expect.objectContaining({
        code: "POLICY_SCHEMA_ERROR",
        path: expect.stringContaining("filesystem")
      })
    );
  });

  it("compiles configured policy into provider-native session and run options", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-policy-native-"));
    const adapter = new PolicyNativeAdapter();
    const harness = createHarness(
      {
        defaultProvider: "codex",
        policy: {
          inline: {
            filesystem: {
              mode: "read-only"
            },
            version: 1
          }
        },
        providers: {
          codex: {
            native: {
              codex: {
                mode: "app-server"
              }
            },
            provider: "codex"
          }
        },
        workspace: {
          cwd
        }
      },
      [adapter]
    );

    const result = await harness.run({
      native: {
        turnOptions: {
          outputSchema: {
            type: "object"
          }
        }
      },
      task: "compile policy into native options"
    });

    expect(result.status).toBe("success");
    expect(adapter.startedSessions[0]?.native).toEqual({
      codex: expect.objectContaining({
        approvalPolicy: [],
        mode: "app-server",
        sandbox: "read-only"
      })
    });
    expect(adapter.runInputs[0]?.native).toEqual(
      expect.objectContaining({
        approvalPolicy: [],
        sandbox: "read-only",
        turnOptions: {
          outputSchema: {
            type: "object"
          }
        }
      })
    );
  });
});

interface PolicyNativeSession {
  cwd: string;
}

interface PolicyNativeRun {
  events: PortableRunEvent[];
  result: RunResult;
}

class PolicyNativeAdapter implements CodingAgentAdapter<
  PolicyNativeSession,
  PolicyNativeRun
> {
  readonly provider = "codex" as const;
  readonly runInputs: RunInput[] = [];
  readonly startedSessions: StartSessionConfig[] = [];
  readonly version = "test";

  async capabilities(): Promise<ProviderCapabilities> {
    const yes = () => capability(true, "stable");
    const no = () => capability(false, "unknown");
    return {
      knownLimitations: [],
      lifecycle: {
        cancel: no(),
        fork: no(),
        resume: no(),
        start: yes(),
        stream: yes(),
        wait: yes()
      },
      observability: {
        commandEvents: no(),
        cost: no(),
        diffEvents: no(),
        fileChangeEvents: no(),
        planEvents: no(),
        rawEventAccess: no(),
        tokenUsage: no(),
        toolCallEvents: no()
      },
      policy: {
        commandAllowDeny: yes(),
        filesystemSandbox: yes(),
        humanApprovals: yes(),
        networkControl: no(),
        providerNativePermissions: yes()
      },
      provider: "codex",
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
        runCommands: no(),
        writeFiles: no()
      }
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<PolicyNativeSession>> {
    this.startedSessions.push(config);
    return {
      createdAt: nowIso(),
      native: {
        cwd: config.workspace.cwd
      },
      provider: "codex",
      sessionId: createSessionId("codex")
    };
  }

  async resumeSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<PolicyNativeSession>> {
    return this.startSession(config);
  }

  async run(
    session: SessionHandle<PolicyNativeSession>,
    input: RunInput
  ): Promise<RunHandle<PolicyNativeRun>> {
    this.runInputs.push(input);
    const runId = createRunId("codex");
    const started: PortableRunEvent = {
      id: `${runId}-event-000001`,
      input: {
        mode: input.mode ?? "edit",
        taskHash: hashTask(input.task)
      },
      provider: "codex",
      runId,
      seq: 1,
      sessionId: session.sessionId,
      ts: nowIso(),
      type: "run.started"
    };
    const completed: PortableRunEvent = {
      id: `${runId}-event-000002`,
      provider: "codex",
      result: {
        status: "success"
      },
      runId,
      seq: 2,
      sessionId: session.sessionId,
      status: "success",
      ts: nowIso(),
      type: "run.completed"
    };
    return {
      native: {
        events: [started, completed],
        result: {
          artifacts: [],
          finalMessage: "done",
          provider: "codex",
          runId,
          sessionId: session.sessionId,
          status: "success"
        }
      },
      provider: "codex",
      runId,
      sessionId: session.sessionId,
      startedAt: nowIso()
    };
  }

  async *stream(run: RunHandle<PolicyNativeRun>): AsyncIterable<PortableRunEvent> {
    yield* run.native.events;
  }

  async wait(run: RunHandle<PolicyNativeRun>): Promise<RunResult> {
    return run.native.result;
  }

  async cancel(): Promise<void> {
    throw new Error("cancel unsupported");
  }
}
