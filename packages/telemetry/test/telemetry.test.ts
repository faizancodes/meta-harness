import { mkdtemp } from "node:fs/promises";
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
} from "@metaharness/core";
import { parsePolicyYaml } from "@metaharness/policy";
import {
  initializeInMemoryTelemetry,
  initializeTelemetry,
  resolveTelemetryOptions,
  TelemetryConfigError,
  TelemetrySetupError
} from "../src/index.js";
import type {
  CodingAgentAdapter,
  PortableRunEvent,
  ProviderCapabilities,
  RunHandle,
  RunInput,
  RunResult,
  ResumeSessionConfig,
  SessionHandle,
  StartSessionConfig
} from "@metaharness/core";

describe("@metaharness/telemetry", () => {
  it("resolves exporter configuration from env and config without starting telemetry", () => {
    expect(resolveTelemetryOptions().exporter).toBe("none");
    expect(
      resolveTelemetryOptions({
        enabled: true
      }).exporter
    ).toBe("otlp");
    expect(
      resolveTelemetryOptions({
        env: {
          metaharness_OTEL_EXPORTER: "console"
        },
        exporter: "none"
      }).exporter
    ).toBe("console");
    expect(
      resolveTelemetryOptions({
        env: {
          METAHARNESS_OTEL_EXPORTER: "otlp"
        }
      }).exporter
    ).toBe("otlp");
    expect(initializeTelemetry({ exporter: "none" })).toBeUndefined();
  });

  it("reports invalid telemetry config with stable error codes", () => {
    let thrown: unknown;
    try {
      resolveTelemetryOptions({
        exporter: "zipkin" as "otlp"
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TelemetryConfigError);
    expect(thrown).toMatchObject({
      code: "TELEMETRY_EXPORTER_UNSUPPORTED",
      details: {
        option: "exporter",
        value: "zipkin"
      },
      name: "TelemetryConfigError"
    });
  });

  it("captures harness and policy spans with an in-memory exporter", async () => {
    const telemetry = initializeInMemoryTelemetry({
      serviceName: "metaharness-test"
    });
    try {
      const cwd = await mkdtemp(join(tmpdir(), "metaharness-telemetry-"));
      const harness = createHarness(
        {
          defaultProvider: "mock",
          providers: {
            mock: {
              provider: "mock",
              runtime: "local"
            }
          },
          workspace: {
            cwd
          }
        },
        [new TelemetryMockAdapter()]
      );

      const result = await harness.run({
        provider: "mock",
        task: "do not export this prompt text"
      });
      expect(result.status).toBe("success");

      const policy = parsePolicyYaml(`version: 1
commands:
  default: deny
`);
      expect(policy.diagnostics.ok).toBe(true);

      await telemetry.forceFlush();
      const spans = telemetry.spanExporter.getFinishedSpans();
      const names = spans.map((span) => span.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "harness.run",
          "provider.startSession",
          "provider.run",
          "provider.stream",
          "provider.wait",
          "workspace.diff",
          "ledger.write",
          "policy.check"
        ])
      );

      const harnessRun = spans.find((span) => span.name === "harness.run");
      expect(harnessRun?.attributes["harness.provider"]).toBe("mock");
      expect(harnessRun?.attributes["harness.status"]).toBe("success");
      expect(harnessRun?.attributes["harness.task_hash"]).toEqual(expect.any(String));
      expect(JSON.stringify(harnessRun?.attributes)).not.toContain(
        "do not export this prompt text"
      );

      const policySpan = spans.find((span) => span.name === "policy.check");
      expect(policySpan?.attributes["harness.status"]).toBe("success");
    } finally {
      await telemetry.shutdown();
    }
  });

  it("reports duplicate in-memory tracer setup with a stable error code", async () => {
    const telemetry = initializeInMemoryTelemetry({
      serviceName: "metaharness-duplicate-telemetry-test"
    });
    try {
      expect(() => initializeInMemoryTelemetry()).toThrow(TelemetrySetupError);
      expect(() => initializeInMemoryTelemetry()).toThrow(
        /shutdown\(\) on the existing telemetry handle/
      );
      let thrown: unknown;
      try {
        initializeInMemoryTelemetry();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        code: "TELEMETRY_TRACER_PROVIDER_CONFLICT",
        name: "TelemetrySetupError"
      });
    } finally {
      await telemetry.shutdown();
    }
  });
});

interface TelemetryMockSession {
  cwd: string;
}

interface TelemetryMockRun {
  events: PortableRunEvent[];
  result: RunResult;
}

class TelemetryMockAdapter implements CodingAgentAdapter<
  TelemetryMockSession,
  TelemetryMockRun
> {
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
        cost: yes(),
        diffEvents: yes(),
        fileChangeEvents: no(),
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
        artifacts: no(),
        gitBranch: no(),
        gitDiff: yes(),
        openPullRequest: no(),
        readFiles: no(),
        runCommands: no(),
        writeFiles: no()
      }
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<TelemetryMockSession>> {
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
  ): Promise<SessionHandle<TelemetryMockSession>> {
    return this.startSession(config);
  }

  async run(
    session: SessionHandle<TelemetryMockSession>,
    input: RunInput
  ): Promise<RunHandle<TelemetryMockRun>> {
    const runId = createRunId("mock");
    const event: PortableRunEvent = {
      id: `${runId}-event-000001`,
      input: {
        mode: input.mode ?? "edit",
        taskHash: hashTask(input.task)
      },
      provider: "mock",
      runId,
      seq: 1,
      sessionId: session.sessionId,
      ts: nowIso(),
      type: "run.started"
    };
    return {
      native: {
        events: [event],
        result: {
          artifacts: [],
          finalMessage: "done",
          provider: "mock",
          runId,
          sessionId: session.sessionId,
          status: "success",
          usage: {
            estimatedCostUsd: 0,
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2
          }
        }
      },
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      startedAt: nowIso()
    };
  }

  async *stream(run: RunHandle<TelemetryMockRun>): AsyncIterable<PortableRunEvent> {
    yield* run.native.events;
  }

  async wait(run: RunHandle<TelemetryMockRun>): Promise<RunResult> {
    return run.native.result;
  }

  async cancel(_run: RunHandle<TelemetryMockRun>): Promise<void> {}
}
