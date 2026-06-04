import { mkdtemp, readFile } from "node:fs/promises";
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
  HarnessInputError,
  nowIso
} from "../src/index.js";
import type {
  CapabilityProbeInput,
  CodingAgentAdapter,
  PortableRunEvent,
  ProviderCapabilities,
  ResumeSessionConfig,
  RunHandle,
  RunInput,
  RunResult,
  SessionLedger,
  SessionHandle,
  StartSessionConfig
} from "../src/index.js";

describe("active run lifecycle", () => {
  it("returns a run handle with replayable events, wait, and cancel", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-active-run-"));
    const adapter = new ActiveRunAdapter();
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
      [adapter]
    );

    const active = await harness.startRun({
      task: "exercise active run"
    });
    const observed = collectEventTypes(active.events());

    await active.cancel();
    const result = await active.wait();

    expect(adapter.cancelledRunId).toBe(active.runId);
    expect(result.status).toBe("cancelled");
    expect(result.runId).toBe(active.runId);
    expect(result.verificationLogPath).toBeDefined();
    expect(await readFile(result.verificationLogPath ?? "", "utf8")).toBe(
      "No verification commands configured.\n"
    );
    expect(await observed).toEqual([
      "run.started",
      "assistant.message.completed",
      "run.completed"
    ]);

    const replayed = await collectEventTypes(active.events());
    expect(replayed).toEqual([
      "run.started",
      "assistant.message.completed",
      "run.completed"
    ]);
  });

  it("passes per-run model and runtime to provider sessions and ledgers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-run-session-options-"));
    const adapter = new ActiveRunAdapter();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            model: "config-model",
            provider: "mock",
            runtime: "local"
          }
        },
        workspace: {
          cwd
        }
      },
      [adapter]
    );

    const runResult = await harness.run({
      model: "run-model",
      runtime: "cloud",
      task: "exercise run session options"
    });
    expect(adapter.startedSessions[0]?.model).toBe("run-model");
    expect(adapter.startedSessions[0]?.runtime).toBe("cloud");
    const runLedger = await harness.exportLedger(runResult.runId);
    expect(runLedger.provider.model).toBe("run-model");
    expect(runLedger.provider.runtime).toBe("cloud");

    const resumeResult = await harness.resume({
      model: "resume-model",
      nativeSessionId: "native-session-123",
      provider: "mock",
      runtime: "self-hosted",
      task: "exercise resume session options"
    });
    expect(adapter.resumedSessions[0]?.model).toBe("resume-model");
    expect(adapter.resumedSessions[0]?.runtime).toBe("self-hosted");
    const resumeLedger = await harness.exportLedger(resumeResult.runId);
    expect(resumeLedger.provider.model).toBe("resume-model");
    expect(resumeLedger.provider.runtime).toBe("self-hosted");
  });

  it("rejects missing run tasks before starting provider sessions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-run-input-invalid-"));
    const adapter = new ActiveRunAdapter();
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
      [adapter]
    );

    await expect(
      harness.run({
        task: "   "
      })
    ).rejects.toMatchObject({
      code: "RUN_TASK_MISSING",
      name: "HarnessInputError"
    });
    await expect(harness.startRun({} as RunInput)).rejects.toBeInstanceOf(
      HarnessInputError
    );
    expect(adapter.startedSessions).toHaveLength(0);
  });

  it("passes provider config into capability probes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-capability-probe-"));
    const adapter = new ActiveRunAdapter();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            auth: {
              apiKey: "capability-test-key"
            },
            provider: "mock",
            runtime: "cloud"
          }
        },
        workspace: {
          cwd
        }
      },
      [adapter]
    );

    await harness.agent("mock").capabilities();

    expect(adapter.capabilityInputs[0]).toEqual({
      auth: {
        apiKey: "capability-test-key"
      },
      cwd,
      runtime: "cloud"
    });
  });

  it("infers same-provider resume options from a supplied ledger", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-resume-ledger-options-"));
    const adapter = new ActiveRunAdapter();
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
      [adapter]
    );

    const sourceResult = await harness.resume({
      model: "ledger-model",
      nativeSessionId: "ledger-native-session",
      provider: "mock",
      runtime: "cloud",
      task: "create source ledger"
    });
    const sourceLedger = await harness.exportLedger(sourceResult.runId);

    await harness.resume({
      ledger: sourceLedger,
      provider: "mock",
      task: "resume from ledger only"
    });

    expect(adapter.resumedSessions.at(-1)).toEqual(
      expect.objectContaining({
        model: "ledger-model",
        nativeSessionId: "ledger-native-session",
        runtime: "cloud"
      })
    );
  });

  it("uses adapter snapshots to enrich portable ledgers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-adapter-snapshot-"));
    const adapter = new SnapshotEnrichingAdapter();
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
      [adapter]
    );

    const result = await harness.run({
      task: "exercise adapter snapshot enrichment"
    });
    const ledger = await harness.exportLedger(result.runId);

    expect(adapter.snapshotSessionCwd).toBe(cwd);
    expect(ledger.summary.finalMessage).toBe(
      "Active run completed: exercise adapter snapshot enrichment"
    );
    expect(ledger.summary.facts).toContain("adapter snapshot fact");
    expect(ledger.summary.openQuestions).toContain("adapter snapshot question");
    expect(ledger.summary.nextSteps).toContain("adapter snapshot next step");
    expect(ledger.files.read).toContain("src/snapshot.ts");
    expect(ledger.files.changed).toContainEqual({
      diff: "diff --metaharness a/snapshot.txt b/snapshot.txt\n",
      kind: "modify",
      path: "snapshot.txt"
    });
    expect(ledger.artifacts).toContainEqual({
      kind: "url",
      name: "adapter snapshot artifact",
      url: "https://example.test/artifact"
    });
    expect(ledger.usage?.inputTokens).toBe(42);
  });

  it("gates raw provider events per run and records the raw log path in the ledger", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-active-raw-"));
    const adapter = new ActiveRunAdapter();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        rawEvents: true,
        workspace: {
          cwd
        }
      },
      [adapter]
    );

    const disabledResult = await harness.run({
      rawEvents: false,
      task: "raw disabled for this run"
    });
    const disabledLedger = await harness.exportLedger(disabledResult.runId);
    expect(disabledLedger.events.rawEventLogPath).toBeUndefined();
    expect(
      await collectEventTypesFromPath(disabledResult.eventLogPath ?? "")
    ).not.toContain("provider.raw");

    const enabledActive = await harness.startRun({
      rawEvents: true,
      task: "raw enabled for this run"
    });
    const enabledObserved = await collectEventTypes(enabledActive.events());
    const enabledResult = await enabledActive.wait();
    const enabledLedger = await harness.exportLedger(enabledResult.runId);

    expect(enabledObserved).toContain("provider.raw");
    expect(enabledLedger.events.rawEventLogPath).toBeTruthy();
    expect(
      await collectEventTypesFromPath(enabledResult.eventLogPath ?? "")
    ).not.toContain("provider.raw");
    const rawLines = (await readFile(enabledLedger.events.rawEventLogPath ?? "", "utf8"))
      .trim()
      .split("\n");
    expect(rawLines).toHaveLength(1);
    expect(rawLines[0]).toContain('"type":"provider.raw"');
    expect(rawLines[0]).toContain("[REDACTED]");
    expect(rawLines[0]).not.toContain("sk-raw-secret-12345678901234567890");
  });

  it("synthesizes lifecycle events when an adapter stream omits them", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-sparse-lifecycle-"));
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
      [new SparseLifecycleAdapter()]
    );

    const active = await harness.startRun({
      task: "sparse lifecycle"
    });
    const observed = collectEventTypes(active.events());
    const result = await active.wait();

    expect(await observed).toEqual(["run.started", "run.completed"]);
    expect(await collectEventTypesFromPath(result.eventLogPath ?? "")).toEqual([
      "run.started",
      "run.completed"
    ]);

    const ledger = await harness.exportLedger(result.runId);
    expect(ledger.events.counts["run.started"]).toBe(1);
    expect(ledger.events.counts["run.completed"]).toBe(1);
    expect(ledger.summary.finalMessage).toBe("Active run completed: sparse lifecycle");
  });
});

async function collectEventTypes(
  events: AsyncIterable<PortableRunEvent>
): Promise<string[]> {
  const types: string[] = [];
  for await (const event of events) {
    types.push(event.type);
  }
  return types;
}

async function collectEventTypesFromPath(path: string): Promise<string[]> {
  const types: string[] = [];
  const content = await readFile(path, "utf8");
  for (const line of content.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    types.push((JSON.parse(line) as PortableRunEvent).type);
  }
  return types;
}

interface ActiveRunSession {
  cwd: string;
}

interface ActiveRunNative {
  cancelled: boolean;
  includeRaw: boolean;
  finalMessage: string;
}

class ActiveRunAdapter implements CodingAgentAdapter<ActiveRunSession, ActiveRunNative> {
  readonly provider = "mock" as const;
  readonly version = "test";
  readonly capabilityInputs: Array<CapabilityProbeInput | undefined> = [];
  cancelledRunId?: string;
  readonly resumedSessions: ResumeSessionConfig[] = [];
  readonly startedSessions: StartSessionConfig[] = [];

  async capabilities(input?: CapabilityProbeInput): Promise<ProviderCapabilities> {
    this.capabilityInputs.push(input);
    const yes = () => capability(true, "stable");
    const no = () => capability(false, "unknown");
    return {
      knownLimitations: [],
      lifecycle: {
        cancel: yes(),
        fork: no(),
        resume: yes(),
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
        runCommands: no(),
        writeFiles: no()
      }
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<ActiveRunSession>> {
    this.startedSessions.push(config);
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
  ): Promise<SessionHandle<ActiveRunSession>> {
    this.resumedSessions.push(config);
    const session: SessionHandle<ActiveRunSession> = {
      createdAt: nowIso(),
      cwd: config.workspace.cwd,
      native: {
        cwd: config.workspace.cwd
      },
      provider: "mock",
      sessionId: config.sessionId ?? createSessionId("mock")
    };
    if (config.nativeSessionId) {
      session.nativeSessionId = config.nativeSessionId;
    }
    return session;
  }

  async run(
    session: SessionHandle<ActiveRunSession>,
    input: RunInput
  ): Promise<RunHandle<ActiveRunNative>> {
    const runId = createRunId("mock");
    const handle: RunHandle<ActiveRunNative> = {
      native: {
        cancelled: false,
        includeRaw: input.rawEvents ?? false,
        finalMessage: `Active run completed: ${input.task}`
      },
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      startedAt: nowIso()
    };
    if (session.nativeSessionId) {
      handle.nativeSessionId = session.nativeSessionId;
    }
    return handle;
  }

  async *stream(run: RunHandle<ActiveRunNative>): AsyncIterable<PortableRunEvent> {
    const base = {
      provider: "mock" as const,
      runId: run.runId,
      sessionId: run.sessionId
    };
    yield {
      ...base,
      id: `${run.runId}-event-000001`,
      input: {
        mode: "edit",
        taskHash: hashTask(run.native.finalMessage)
      },
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      type: "run.started"
    };
    await delay(10);
    const assistantSeq = run.native.includeRaw ? 3 : 2;
    const completedSeq = run.native.includeRaw ? 4 : 3;
    if (run.native.includeRaw) {
      yield {
        ...base,
        id: `${run.runId}-event-000002`,
        providerEventType: "mock.raw",
        raw: {
          token: "sk-raw-secret-12345678901234567890"
        },
        seq: 2,
        ts: "2026-01-01T00:00:00.500Z",
        type: "provider.raw"
      };
      await delay(10);
    }
    yield {
      ...base,
      id: `${run.runId}-event-${String(assistantSeq).padStart(6, "0")}`,
      phase: "final",
      seq: assistantSeq,
      text: run.native.finalMessage,
      ts: "2026-01-01T00:00:01.000Z",
      type: "assistant.message.completed"
    };
    await delay(10);
    const status = run.native.cancelled ? "cancelled" : "success";
    yield {
      ...base,
      finalMessage: status === "cancelled" ? "cancelled" : run.native.finalMessage,
      id: `${run.runId}-event-${String(completedSeq).padStart(6, "0")}`,
      result: {
        status
      },
      seq: completedSeq,
      status,
      ts: "2026-01-01T00:00:02.000Z",
      type: "run.completed"
    };
  }

  async wait(run: RunHandle<ActiveRunNative>): Promise<RunResult> {
    await delay(10);
    const result: RunResult = {
      artifacts: [],
      finalMessage: run.native.cancelled ? "cancelled" : run.native.finalMessage,
      provider: "mock",
      runId: run.runId,
      sessionId: run.sessionId,
      status: run.native.cancelled ? "cancelled" : "success"
    };
    if (run.nativeSessionId) {
      result.nativeSessionId = run.nativeSessionId;
    }
    return result;
  }

  async cancel(run: RunHandle<ActiveRunNative>): Promise<void> {
    this.cancelledRunId = run.runId;
    run.native.cancelled = true;
  }
}

class SparseLifecycleAdapter extends ActiveRunAdapter {
  override stream(_run: RunHandle<ActiveRunNative>): AsyncIterable<PortableRunEvent> {
    return emptyPortableEvents();
  }
}

class SnapshotEnrichingAdapter extends ActiveRunAdapter {
  snapshotSessionCwd?: string;

  async snapshot(
    session: SessionHandle<ActiveRunSession>
  ): Promise<Partial<SessionLedger>> {
    this.snapshotSessionCwd = session.native.cwd;
    return {
      artifacts: [
        {
          kind: "url",
          name: "adapter snapshot artifact",
          url: "https://example.test/artifact"
        }
      ],
      files: {
        changed: [
          {
            diff: "diff --metaharness a/snapshot.txt b/snapshot.txt\n",
            kind: "modify",
            path: "snapshot.txt"
          }
        ],
        read: ["src/snapshot.ts"]
      },
      summary: {
        facts: ["adapter snapshot fact"],
        finalMessage: "snapshot final message should not replace result",
        nextSteps: ["adapter snapshot next step"],
        openQuestions: ["adapter snapshot question"]
      },
      usage: {
        inputTokens: 42
      }
    };
  }
}

async function* emptyPortableEvents(): AsyncIterable<PortableRunEvent> {
  yield* [];
}
