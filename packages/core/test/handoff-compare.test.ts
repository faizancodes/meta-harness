import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
import { createTinyGitRepo } from "./git-fixtures.js";
import type {
  CodingAgentAdapter,
  CompareInput,
  HandoffInput,
  PortableRunEvent,
  ProviderCapabilities,
  ResumeSessionConfig,
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle,
  StartSessionConfig
} from "../src/index.js";

describe("handoff and compare", () => {
  it("compares mock providers and writes compare artifacts", async () => {
    const repo = await createTinyGitRepo();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd: repo.cwd
        }
      },
      [new LedgerMockAdapter()]
    );

    const result = await harness.compare({
      providers: ["mock", "mock"],
      task: "compare task",
      verification: ["git status"]
    });

    expect(result.runs).toHaveLength(2);
    expect(result.summary).toHaveLength(2);
    expect(result.summary.every((entry) => entry.testsPassed)).toBe(true);
    expect(result.compareJsonPath).toBeDefined();
    expect(result.compareMarkdownPath).toBeDefined();
    expect(await exists(result.compareJsonPath ?? "")).toBe(true);
    expect(await exists(result.compareMarkdownPath ?? "")).toBe(true);

    const compareJson = JSON.parse(
      await readFile(result.compareJsonPath ?? "", "utf8")
    ) as { id: string; runs: unknown[] };
    expect(compareJson.id).toBe(result.id);
    expect(compareJson.runs).toHaveLength(2);
    const compareMarkdown = await readFile(result.compareMarkdownPath ?? "", "utf8");
    expect(compareMarkdown).toContain("# metaharness compare");
    expect(compareMarkdown).toContain("provider | run id | status | verify");
    expect(compareMarkdown).toContain(
      `mock | ${result.runs[0]?.runId ?? ""} | success | pass`
    );
  });

  it("hands off a ledger to another mock run without claiming native session transfer", async () => {
    const repo = await createTinyGitRepo();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd: repo.cwd
        }
      },
      [new LedgerMockAdapter()]
    );

    const compare = await harness.compare({
      providers: ["mock"],
      task: "fix the thing",
      verification: ["git status"]
    });
    const fromRun = compare.runs[0];
    if (!fromRun) {
      throw new Error("Expected compare to produce a source run.");
    }

    const handoff = await harness.handoff({
      fromRunId: fromRun.runId,
      instruction: "Continue with a smaller patch.",
      toProvider: "mock"
    });

    expect(handoff.toRun.status).toBe("success");
    expect(await exists(handoff.handoffPromptPath)).toBe(true);
    const prompt = await readFile(handoff.handoffPromptPath, "utf8");
    expect(prompt).toContain("## Original task");
    expect(prompt).toContain("fix the thing");
    expect(prompt).toContain("## Latest plan");
    expect(prompt).toContain("Record the requested task");
    expect(prompt).toContain("## Commands already run");
    expect(prompt).toContain("mock verify");
    expect(prompt).toContain("## Files changed");
    expect(prompt).toContain("MOCK.md (create)");
    expect(prompt).toContain("## Verification");
    expect(prompt).toContain("git status");
    expect(prompt).toContain("## Current diff");
    const patchPath = fromRun.patchPath;
    if (!patchPath) {
      throw new Error("Expected source run to have a patch path.");
    }
    expect(prompt).toContain(patchPath);
    expect(prompt).toContain("does not transfer hidden provider-native session state");
    expect(prompt).toContain("Continue with a smaller patch.");

    const toLedger = await harness.exportLedger(handoff.toRun.runId);
    expect(toLedger.handoffFrom).toEqual({
      ledgerId: handoff.fromLedger.ledgerId,
      provider: "mock",
      runId: fromRun.runId
    });
  });

  it("applies handoff patches to the isolated destination workspace before running", async () => {
    const repo = await createTinyGitRepo();
    const adapter = new PatchAwareHandoffAdapter();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd: repo.cwd
        }
      },
      [adapter]
    );

    const sourceRun = await harness.run({
      task: "source patch task"
    });
    expect(sourceRun.patchPath).toBeDefined();

    const handoff = await harness.handoff({
      applyPatch: true,
      fromRunId: sourceRun.runId,
      toProvider: "mock",
      workspace: {
        git: {
          branchPrefix: "handoff/",
          createWorktree: true,
          worktreeRoot: ".harness/handoff-worktrees"
        }
      }
    });

    expect(handoff.toRun.status).toBe("success");
    expect(adapter.sawAppliedPatchInLatestSession).toBe(true);
    expect(adapter.latestSessionCwd).toContain(".harness/handoff-worktrees");
    expect(await exists(adapter.latestSessionCwd)).toBe(false);
  });

  it("applies non-git snapshot handoff patches before running", async () => {
    const sourceCwd = await mkdtemp(
      join(tmpdir(), "metaharness-handoff-source-non-git-")
    );
    const destinationCwd = await mkdtemp(
      join(tmpdir(), "metaharness-handoff-dest-non-git-")
    );
    const adapter = new SnapshotPatchHandoffAdapter();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd: sourceCwd
        }
      },
      [adapter]
    );

    const sourceRun = await harness.run({
      task: "non-git source patch"
    });
    expect(sourceRun.diff).toContain("diff --metaharness /dev/null b/SNAPSHOT.md");
    expect(sourceRun.patchPath).toBeDefined();

    const handoff = await harness.handoff({
      applyPatch: true,
      fromRunId: sourceRun.runId,
      toProvider: "mock",
      workspace: {
        cwd: destinationCwd
      }
    });

    expect(handoff.toRun.status).toBe("success");
    expect(adapter.latestSessionCwd).toBe(destinationCwd);
    expect(adapter.sawAppliedSnapshotInLatestSession).toBe(true);
    expect(await readFile(join(destinationCwd, "SNAPSHOT.md"), "utf8")).toContain(
      "snapshot from non-git source patch"
    );
  });

  it("honors compare maxConcurrency and keeps output ordered by provider input", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-compare-concurrency-"));
    const adapter = new ConcurrentCompareAdapter();
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

    const result = await harness.compare({
      providers: ["mock", "mock", "mock"],
      strategy: {
        isolatedWorktrees: false,
        maxConcurrency: 2
      },
      task: "compare concurrently"
    });

    expect(result.runs).toHaveLength(3);
    expect(result.summary.map((entry) => entry.provider)).toEqual([
      "mock",
      "mock",
      "mock"
    ]);
    expect(adapter.maxActiveWaits).toBe(2);
  });

  it("rejects invalid compare maxConcurrency values", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-compare-invalid-"));
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
      [new LedgerMockAdapter()]
    );

    await expect(
      harness.compare({
        providers: ["mock"],
        strategy: {
          isolatedWorktrees: false,
          maxConcurrency: 0
        },
        task: "invalid concurrency"
      })
    ).rejects.toMatchObject({
      code: "COMPARE_INVALID_CONCURRENCY"
    });
  });

  it("rejects incomplete compare input before starting provider sessions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-compare-input-invalid-"));
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
      [new LedgerMockAdapter()]
    );

    await expect(
      harness.compare({
        providers: ["mock"],
        task: "   "
      })
    ).rejects.toMatchObject({
      code: "COMPARE_TASK_MISSING",
      name: "HarnessInputError"
    });

    const missingProviders = harness.compare({
      task: "compare without providers"
    } as unknown as CompareInput);
    await expect(missingProviders).rejects.toBeInstanceOf(HarnessInputError);
    await expect(missingProviders).rejects.toMatchObject({
      code: "COMPARE_NO_PROVIDERS"
    });
  });

  it("rejects incomplete handoff input before reading artifacts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-handoff-input-invalid-"));
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
      [new LedgerMockAdapter()]
    );

    await expect(
      harness.handoff({
        fromRunId: "",
        toProvider: "mock"
      } as HandoffInput)
    ).rejects.toMatchObject({
      code: "HANDOFF_SOURCE_MISSING",
      name: "HarnessInputError"
    });
    await expect(
      harness.handoff({
        fromRunId: "missing-run"
      } as HandoffInput)
    ).rejects.toMatchObject({
      code: "HANDOFF_PROVIDER_MISSING",
      name: "HarnessInputError"
    });
  });
});

async function exists(path: string): Promise<boolean> {
  if (!path) {
    return false;
  }
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

interface LedgerMockSession {
  cwd: string;
}

interface LedgerMockRun {
  diff: string;
  events: PortableRunEvent[];
  finalMessage: string;
}

class LedgerMockAdapter implements CodingAgentAdapter<LedgerMockSession, LedgerMockRun> {
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
        commandEvents: yes(),
        cost: no(),
        diffEvents: yes(),
        fileChangeEvents: yes(),
        planEvents: yes(),
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
        gitDiff: yes(),
        openPullRequest: no(),
        readFiles: no(),
        runCommands: yes(),
        writeFiles: yes()
      }
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<LedgerMockSession>> {
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
  ): Promise<SessionHandle<LedgerMockSession>> {
    return this.startSession(config);
  }

  async run(
    session: SessionHandle<LedgerMockSession>,
    input: RunInput
  ): Promise<RunHandle<LedgerMockRun>> {
    const runId = createRunId("mock");
    const finalMessage = `Mock completed: ${input.task}`;
    const diff = [
      "diff --git a/MOCK.md b/MOCK.md",
      "new file mode 100644",
      "index 0000000..1111111",
      "--- /dev/null",
      "+++ b/MOCK.md",
      "@@ -0,0 +1 @@",
      `+${finalMessage}`,
      ""
    ].join("\n");
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
        explanation: "Mock plan.",
        id: `${runId}-event-000002`,
        seq: 2,
        steps: [
          {
            status: "completed",
            step: "Record the requested task"
          }
        ],
        ts: "2026-01-01T00:00:01.000Z",
        type: "plan.updated"
      },
      {
        ...base,
        command: "mock verify",
        cwd: session.native.cwd,
        id: `${runId}-event-000003`,
        seq: 3,
        ts: "2026-01-01T00:00:02.000Z",
        type: "command.started"
      },
      {
        ...base,
        command: "mock verify",
        cwd: session.native.cwd,
        exitCode: 0,
        id: `${runId}-event-000004`,
        outputSummary: "Mock verification passed.",
        seq: 4,
        ts: "2026-01-01T00:00:03.000Z",
        type: "command.finished"
      },
      {
        ...base,
        changeKind: "create",
        diff,
        id: `${runId}-event-000005`,
        path: "MOCK.md",
        seq: 5,
        status: "completed",
        ts: "2026-01-01T00:00:04.000Z",
        type: "file.change.finished"
      },
      {
        ...base,
        id: `${runId}-event-000006`,
        seq: 6,
        ts: "2026-01-01T00:00:05.000Z",
        type: "diff.updated",
        unifiedDiff: diff
      },
      {
        ...base,
        finalMessage,
        id: `${runId}-event-000007`,
        result: {
          finalMessage,
          status: "success"
        },
        seq: 7,
        status: "success",
        ts: "2026-01-01T00:00:06.000Z",
        type: "run.completed"
      }
    ];
    return {
      native: {
        diff,
        events,
        finalMessage
      },
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      startedAt: "2026-01-01T00:00:00.000Z"
    };
  }

  async *stream(run: RunHandle<LedgerMockRun>): AsyncIterable<PortableRunEvent> {
    for (const event of run.native.events) {
      yield event;
    }
  }

  async wait(run: RunHandle<LedgerMockRun>): Promise<RunResult> {
    return {
      artifacts: [
        {
          kind: "patch",
          name: "mock-diff.patch"
        }
      ],
      diff: run.native.diff,
      finalMessage: run.native.finalMessage,
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

class ConcurrentCompareAdapter extends LedgerMockAdapter {
  private activeWaits = 0;
  private releaseWaiters: Array<() => void> = [];
  maxActiveWaits = 0;

  override async wait(run: RunHandle<LedgerMockRun>): Promise<RunResult> {
    this.activeWaits += 1;
    this.maxActiveWaits = Math.max(this.maxActiveWaits, this.activeWaits);
    if (this.maxActiveWaits >= 2) {
      this.releaseConcurrentWaiters();
    }
    try {
      await this.waitForConcurrentPeer();
      return await super.wait(run);
    } finally {
      this.activeWaits -= 1;
    }
  }

  private async waitForConcurrentPeer(): Promise<void> {
    if (this.maxActiveWaits >= 2) {
      return;
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        this.releaseWaiters.push(resolve);
      }),
      delay(250)
    ]);
  }

  private releaseConcurrentWaiters(): void {
    for (const release of this.releaseWaiters.splice(0)) {
      release();
    }
  }
}

class PatchAwareHandoffAdapter extends LedgerMockAdapter {
  latestSessionCwd = "";
  sawAppliedPatchInLatestSession = false;

  override async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<LedgerMockSession>> {
    this.latestSessionCwd = config.workspace.cwd;
    this.sawAppliedPatchInLatestSession = await this.hasAppliedSourcePatch(
      config.workspace.cwd
    );
    return super.startSession(config);
  }

  private async hasAppliedSourcePatch(cwd: string): Promise<boolean> {
    try {
      const text = await readFile(join(cwd, "MOCK.md"), "utf8");
      return text.includes("Mock completed: source patch task");
    } catch {
      return false;
    }
  }
}

class SnapshotPatchHandoffAdapter extends LedgerMockAdapter {
  latestSessionCwd = "";
  sawAppliedSnapshotInLatestSession = false;

  override async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<LedgerMockSession>> {
    this.latestSessionCwd = config.workspace.cwd;
    this.sawAppliedSnapshotInLatestSession = await this.hasAppliedSnapshotPatch(
      config.workspace.cwd
    );
    return super.startSession(config);
  }

  override async run(
    session: SessionHandle<LedgerMockSession>,
    input: RunInput
  ): Promise<RunHandle<LedgerMockRun & { cwd: string }>> {
    const runId = createRunId("mock");
    const finalMessage = `Snapshot completed: ${input.task}`;
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
        finalMessage,
        id: `${runId}-event-000002`,
        result: {
          finalMessage,
          status: "success"
        },
        seq: 2,
        status: "success",
        ts: "2026-01-01T00:00:01.000Z",
        type: "run.completed"
      }
    ];
    return {
      native: {
        cwd: session.native.cwd,
        diff: "",
        events,
        finalMessage
      },
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      startedAt: "2026-01-01T00:00:00.000Z"
    };
  }

  override async wait(
    run: RunHandle<LedgerMockRun & { cwd?: string }>
  ): Promise<RunResult> {
    if (run.native.cwd) {
      await writeFile(
        join(run.native.cwd, "SNAPSHOT.md"),
        "snapshot from non-git source patch\n",
        "utf8"
      );
    }
    return {
      artifacts: [],
      finalMessage: run.native.finalMessage,
      provider: "mock",
      runId: run.runId,
      sessionId: run.sessionId,
      status: "success"
    };
  }

  private async hasAppliedSnapshotPatch(cwd: string): Promise<boolean> {
    try {
      const text = await readFile(join(cwd, "SNAPSHOT.md"), "utf8");
      return text.includes("snapshot from non-git source patch");
    } catch {
      return false;
    }
  }
}
