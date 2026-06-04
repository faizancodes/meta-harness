import { setTimeout as delay } from "node:timers/promises";
import { capability, createRunId, createSessionId, nowIso } from "@metaharness/core";
import { createMockRunScript } from "./scripted-run.js";
import type {
  CodingAgentAdapter,
  ProviderCapabilities,
  PortableRunEvent,
  ResumeSessionConfig,
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle,
  StartSessionConfig
} from "@metaharness/core";
import type { MockRunScript } from "./scripted-run.js";

export interface MockNativeSession {
  cwd: string;
}

export interface MockNativeRun {
  script: MockRunScript;
}

export class MockAdapter implements CodingAgentAdapter<MockNativeSession, MockNativeRun> {
  readonly provider = "mock" as const;
  readonly version = "0.1.0";

  async capabilities(): Promise<ProviderCapabilities> {
    const yes = (notes?: string) => capability(true, "stable", notes);
    const no = (notes?: string) => capability(false, "unknown", notes);
    return {
      provider: "mock",
      runtime: {
        local: yes(),
        cloud: no("Mock adapter runs locally only."),
        selfHosted: no("Mock adapter is an in-process test adapter.")
      },
      lifecycle: {
        start: yes(),
        stream: yes(),
        wait: yes(),
        cancel: yes("Cancellation is supported for asynchronous mock test runs."),
        resume: yes("Resume returns a deterministic local session handle."),
        fork: no()
      },
      workspace: {
        readFiles: no("Mock adapter does not inspect the filesystem."),
        writeFiles: no("Mock adapter emits synthetic file-change events only."),
        runCommands: no("Mock adapter emits synthetic command events only."),
        gitDiff: no("Mock runs do not inspect or modify the filesystem."),
        gitBranch: no(),
        openPullRequest: no(),
        artifacts: yes("Synthetic patch artifacts are represented in results.")
      },
      tools: {
        mcp: no(
          "Mock does not exercise MCP; real adapters pass provider-native MCP through."
        ),
        skills: no(),
        subagents: no(),
        hooks: no(),
        webSearch: no()
      },
      policy: {
        filesystemSandbox: no(),
        commandAllowDeny: no(),
        networkControl: no(),
        humanApprovals: no(),
        providerNativePermissions: no()
      },
      observability: {
        tokenUsage: yes("Token counts are deterministic mock counts."),
        cost: no(),
        planEvents: yes(),
        diffEvents: yes(),
        commandEvents: yes(),
        fileChangeEvents: yes(),
        toolCallEvents: no(),
        rawEventAccess: no("Raw events are intentionally unnecessary for mock runs.")
      },
      knownLimitations: [
        "Synthetic events only.",
        "Does not execute commands or modify files.",
        "Does not model provider-native hidden session state."
      ]
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<MockNativeSession>> {
    return {
      provider: "mock",
      sessionId: createSessionId("mock"),
      native: {
        cwd: config.workspace.cwd
      },
      createdAt: nowIso(),
      cwd: config.workspace.cwd
    };
  }

  async resumeSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<MockNativeSession>> {
    const session: SessionHandle<MockNativeSession> = {
      provider: "mock",
      sessionId: config.sessionId ?? createSessionId("mock"),
      native: {
        cwd: config.workspace.cwd
      },
      createdAt: nowIso(),
      cwd: config.workspace.cwd
    };
    if (config.nativeSessionId) {
      session.nativeSessionId = config.nativeSessionId;
    }
    return session;
  }

  async run(
    session: SessionHandle<MockNativeSession>,
    input: RunInput
  ): Promise<RunHandle<MockNativeRun>> {
    const runId = createRunId("mock");
    const script = createMockRunScript(session, runId, input);
    const handle: RunHandle<MockNativeRun> = {
      provider: "mock",
      runId,
      sessionId: session.sessionId,
      native: {
        script
      },
      startedAt: script.events[0]?.ts ?? nowIso()
    };
    if (session.nativeSessionId) {
      handle.nativeSessionId = session.nativeSessionId;
    }
    return handle;
  }

  async *stream(run: RunHandle<MockNativeRun>): AsyncIterable<PortableRunEvent> {
    const script = run.native.script;
    for (const event of script.events) {
      if (event.seq > 1 && script.eventDelayMs > 0) {
        await delay(script.eventDelayMs);
      }
      if (script.cancelled && event.type !== "run.started") {
        yield createMockRunStatus(run, event.seq);
        yield createMockRunCompleted(run, event.seq + 1);
        script.completed = true;
        return;
      }
      yield event;
      if (event.type === "run.completed") {
        script.completed = true;
      }
    }
  }

  async wait(run: RunHandle<MockNativeRun>): Promise<RunResult> {
    const status = run.native.script.cancelled ? "cancelled" : "success";
    const finalMessage =
      status === "cancelled" ? "Mock run cancelled." : run.native.script.finalMessage;
    const result: RunResult = {
      provider: "mock",
      runId: run.runId,
      sessionId: run.sessionId,
      status,
      finalMessage,
      artifacts:
        status === "cancelled"
          ? []
          : [
              {
                kind: "patch",
                name: "mock-diff.patch"
              }
            ],
      usage: run.native.script.usage,
      native: {
        mock: true
      }
    };
    if (status !== "cancelled") {
      result.diff = run.native.script.diff;
    }
    if (run.nativeSessionId) {
      result.nativeSessionId = run.nativeSessionId;
    }
    return result;
  }

  async cancel(run: RunHandle<MockNativeRun>): Promise<void> {
    if (run.native.script.completed) {
      return;
    }
    run.native.script.cancelled = true;
  }
}

function createMockRunStatus(
  run: RunHandle<MockNativeRun>,
  seq: number
): PortableRunEvent {
  return {
    id: `${run.runId}-event-${String(seq).padStart(6, "0")}`,
    message: "Mock run cancelled by harness request.",
    provider: "mock",
    runId: run.runId,
    seq,
    sessionId: run.sessionId,
    status: "cancelling",
    ts: new Date(seq * 1000).toISOString(),
    type: "run.status"
  };
}

function createMockRunCompleted(
  run: RunHandle<MockNativeRun>,
  seq: number
): PortableRunEvent {
  return {
    finalMessage: "Mock run cancelled.",
    id: `${run.runId}-event-${String(seq).padStart(6, "0")}`,
    provider: "mock",
    result: {
      finalMessage: "Mock run cancelled.",
      status: "cancelled"
    },
    runId: run.runId,
    seq,
    sessionId: run.sessionId,
    status: "cancelled",
    ts: new Date(seq * 1000).toISOString(),
    type: "run.completed"
  };
}
