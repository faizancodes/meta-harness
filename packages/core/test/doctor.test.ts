import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { capability, createHarness } from "../src/index.js";
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

describe("harness doctor", () => {
  it("reports SDK-level core and provider diagnostics", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-doctor-"));
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
      [new DoctorAdapter()]
    );

    const report = await harness.doctor({ provider: "mock" });

    expect(report.ok).toBe(true);
    expect(report.providers).toEqual([
      {
        provider: "mock",
        registered: true
      }
    ]);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "core",
          name: "node >=22",
          status: "ok"
        }),
        expect.objectContaining({
          category: "core",
          name: "workspace exists",
          status: "ok"
        }),
        expect.objectContaining({
          category: "core",
          name: "run directory writable",
          status: "ok"
        }),
        expect.objectContaining({
          category: "core",
          name: "policy valid",
          status: "skip"
        }),
        expect.objectContaining({
          category: "core",
          name: "git status",
          status: "warn"
        }),
        expect.objectContaining({
          category: "mock",
          name: "mock adapter registered",
          status: "ok"
        }),
        expect.objectContaining({
          category: "mock",
          name: "capabilities loaded",
          status: "ok"
        }),
        expect.objectContaining({
          category: "mock",
          name: "api key present",
          status: "skip"
        })
      ])
    );
  });

  it("fails when configured provider auth is missing or policy is invalid", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-doctor-fail-"));
    const envName = "METAHARNESS_TEST_MISSING_PROVIDER_KEY";
    delete process.env[envName];
    const harness = createHarness(
      {
        policy: {
          inline: {
            filesystem: {
              mode: "danger"
            },
            version: 1
          }
        },
        providers: {
          codex: {
            apiKeyEnv: envName,
            provider: "codex"
          }
        },
        workspace: {
          cwd
        }
      },
      []
    );

    const report = await harness.doctor({ provider: "codex" });

    expect(report.ok).toBe(false);
    expect(report.providers).toEqual([
      {
        provider: "codex",
        registered: false
      }
    ]);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "core",
          name: "policy valid",
          status: "fail"
        }),
        expect.objectContaining({
          category: "codex",
          name: "codex adapter registered",
          status: "fail"
        }),
        expect.objectContaining({
          category: "codex",
          name: "capabilities loaded",
          status: "skip"
        }),
        expect.objectContaining({
          category: "codex",
          message: envName,
          name: "api key present",
          status: "fail"
        })
      ])
    );
  });
});

interface DoctorSession {
  cwd: string;
}

interface DoctorRun {
  finalMessage: string;
}

class DoctorAdapter implements CodingAgentAdapter<DoctorSession, DoctorRun> {
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

  async startSession(config: StartSessionConfig): Promise<SessionHandle<DoctorSession>> {
    return {
      createdAt: new Date().toISOString(),
      cwd: config.workspace.cwd,
      native: {
        cwd: config.workspace.cwd
      },
      provider: "mock",
      sessionId: "doctor-session"
    };
  }

  async resumeSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<DoctorSession>> {
    return this.startSession(config);
  }

  async run(
    session: SessionHandle<DoctorSession>,
    input: RunInput
  ): Promise<RunHandle<DoctorRun>> {
    return {
      native: {
        finalMessage: input.task
      },
      provider: "mock",
      runId: "doctor-run",
      sessionId: session.sessionId,
      startedAt: new Date().toISOString()
    };
  }

  async *stream(): AsyncIterable<PortableRunEvent> {}

  async wait(run: RunHandle<DoctorRun>): Promise<RunResult> {
    return {
      artifacts: [],
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
