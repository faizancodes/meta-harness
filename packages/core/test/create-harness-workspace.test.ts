import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
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
import { createTinyGitRepo, pathExists } from "./git-fixtures.js";
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

describe("createHarness workspace integration", () => {
  it("captures Git diff into result, patch, ledger, and synthetic diff event", async () => {
    const repo = await createTinyGitRepo();
    const adapter = new EditingAdapter();
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

    const result = await harness.run({
      task: "edit tracked file"
    });

    expect(result.diff).toContain("+export const value = 42;");
    expect(result.patchPath).toBeDefined();
    expect(await readFile(result.patchPath ?? "", "utf8")).toContain(
      "+export const value = 42;"
    );

    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PortableRunEvent);
    expect(events.some((event) => event.type === "diff.updated")).toBe(true);

    const ledger = await harness.exportLedger(result.runId);
    expect(ledger.workspace.dirtyBefore).toBe(false);
    expect(ledger.workspace.dirtyAfter).toBe(true);
    expect(ledger.workspace.repo?.startingCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(ledger.workspace.repo?.endingCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(ledger.diff.stats?.filesChanged).toBe(1);
    expect(ledger.diff.patchPath).toBe(result.patchPath);
  });

  it("captures untracked Git files into result, patch, ledger, and synthetic diff event", async () => {
    const repo = await createTinyGitRepo();
    const adapter = new CreatingAdapter();
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

    const result = await harness.run({
      task: "create untracked file"
    });

    expect(result.diff).toContain("diff --git a/NEW.md b/NEW.md");
    expect(result.diff).toContain("+created by adapter");
    expect(result.patchPath).toBeDefined();
    expect(await readFile(result.patchPath ?? "", "utf8")).toContain(
      "+created by adapter"
    );

    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as PortableRunEvent);
    expect(events.some((event) => event.type === "diff.updated")).toBe(true);

    const ledger = await harness.exportLedger(result.runId);
    expect(ledger.workspace.dirtyBefore).toBe(false);
    expect(ledger.workspace.dirtyAfter).toBe(true);
    expect(ledger.diff.stats?.filesChanged).toBe(1);
    expect(ledger.diff.patchPath).toBe(result.patchPath);
  });

  it("captures non-git workspace changes with the snapshot diff fallback", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-harness-non-git-"));
    await mkdir(join(cwd, "src"), {
      recursive: true
    });
    await writeFile(join(cwd, "src", "index.ts"), "export const value = 1;\n", "utf8");
    const adapter = new EditingAdapter();
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
      task: "edit non-git file"
    });

    expect(result.diff).toContain("diff --metaharness a/src/index.ts b/src/index.ts");
    expect(result.diff).toContain("+export const value = 42;");
    expect(result.patchPath).toBeDefined();
    expect(await readFile(result.patchPath ?? "", "utf8")).toContain(
      "+export const value = 42;"
    );

    const ledger = await harness.exportLedger(result.runId);
    expect(ledger.workspace.dirtyBefore).toBe(false);
    expect(ledger.workspace.dirtyAfter).toBe(true);
    expect(ledger.workspace.repo).toBeUndefined();
    expect(ledger.diff.stats?.filesChanged).toBe(1);
    expect(ledger.diff.patchPath).toBe(result.patchPath);
  });

  it("enforces requireClean before starting the provider session", async () => {
    const repo = await createTinyGitRepo();
    await writeFile(repo.sourcePath, "export const value = 9;\n", "utf8");
    const adapter = new EditingAdapter();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd: repo.cwd,
          git: {
            requireClean: true
          }
        }
      },
      [adapter]
    );

    await expect(
      harness.run({
        task: "should not start"
      })
    ).rejects.toThrow(/requireClean/);
    expect(adapter.startSessionCalls).toBe(0);
  });

  it("cleans up isolated worktrees when policy validation fails after prepare", async () => {
    const repo = await createTinyGitRepo();
    const adapter = new EditingAdapter();
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd: repo.cwd,
          git: {
            createWorktree: true
          }
        }
      },
      [adapter]
    );

    await expect(
      harness.run({
        policy: {
          inline: {
            filesystem: {
              mode: "danger"
            },
            version: 1
          }
        },
        task: "invalid policy should not leak a worktree"
      })
    ).rejects.toThrow(/Run policy is invalid/);

    expect(adapter.startSessionCalls).toBe(0);
    const worktreeRoot = join(repo.cwd, ".harness", "worktrees");
    const worktreeEntries = (await pathExists(worktreeRoot))
      ? await readdir(worktreeRoot)
      : [];
    expect(worktreeEntries).toEqual([]);
  });
});

interface EditingSession {
  cwd: string;
}

interface EditingRun {
  cwd: string;
  events: PortableRunEvent[];
}

class EditingAdapter implements CodingAgentAdapter<EditingSession, EditingRun> {
  readonly provider = "mock" as const;
  readonly version = "test";
  startSessionCalls = 0;

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
        writeFiles: yes()
      }
    };
  }

  async startSession(config: StartSessionConfig): Promise<SessionHandle<EditingSession>> {
    this.startSessionCalls += 1;
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
  ): Promise<SessionHandle<EditingSession>> {
    return this.startSession(config);
  }

  async run(
    session: SessionHandle<EditingSession>,
    input: RunInput
  ): Promise<RunHandle<EditingRun>> {
    const runId = createRunId("mock");
    const base = {
      provider: "mock" as const,
      runId,
      sessionId: session.sessionId
    };
    return {
      native: {
        cwd: session.native.cwd,
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
            finalMessage: "edited",
            id: `${runId}-event-000002`,
            seq: 2,
            status: "success",
            ts: "2026-01-01T00:00:01.000Z",
            type: "run.completed"
          }
        ]
      },
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      startedAt: "2026-01-01T00:00:00.000Z"
    };
  }

  async *stream(run: RunHandle<EditingRun>): AsyncIterable<PortableRunEvent> {
    for (const event of run.native.events) {
      yield event;
    }
  }

  async wait(run: RunHandle<EditingRun>): Promise<RunResult> {
    await writeFile(
      `${run.native.cwd}/src/index.ts`,
      "export const value = 42;\n",
      "utf8"
    );
    return {
      artifacts: [],
      finalMessage: "edited",
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

class CreatingAdapter extends EditingAdapter {
  override async wait(run: RunHandle<EditingRun>): Promise<RunResult> {
    await writeFile(join(run.native.cwd, "NEW.md"), "created by adapter\n", "utf8");
    return {
      artifacts: [],
      finalMessage: "created",
      provider: "mock",
      runId: run.runId,
      sessionId: run.sessionId,
      status: "success"
    };
  }
}
