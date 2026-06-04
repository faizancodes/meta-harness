import {
  HarnessError,
  UnsupportedCapabilityError,
  capability,
  createRunId,
  createSessionId,
  nowIso
} from "@metaharness/core";
import {
  buildCursorAgentOptions,
  buildCursorSendOptions,
  resolveCursorRuntime
} from "./map-config.js";
import {
  artifactsFromCursorArtifacts,
  createErrorEvent,
  createRawProviderEvent,
  createRunCompletedEvent,
  createRunStartedEvent,
  createRunStatusEvent,
  mapCursorEvent,
  mapCursorResultToRunResult,
  normalizeError
} from "./map-events.js";
import type {
  CursorAdapterOptions,
  CursorAgentLike,
  CursorNativeRun,
  CursorNativeSession,
  CursorRunHandle,
  CursorRunOperationLike,
  CursorRunResultLike,
  CursorSdkLoader,
  CursorSdkModule,
  CursorSessionHandle
} from "./types.js";
import type {
  CapabilityProbeInput,
  CodingAgentAdapter,
  PortableRunEvent,
  ProviderCapabilities,
  ResumeSessionConfig,
  RunHandle,
  RunInput,
  RunResult,
  SessionHandle,
  StartSessionConfig
} from "@metaharness/core";

export class CursorAdapter implements CodingAgentAdapter<
  CursorNativeSession,
  CursorNativeRun
> {
  readonly provider = "cursor" as const;
  readonly version = "0.1.0";

  private readonly loadSdk: CursorSdkLoader;
  private readonly agents = new Set<CursorAgentLike>();

  constructor(options: CursorAdapterOptions = {}) {
    this.loadSdk = options.loadSdk ?? defaultCursorSdkLoader;
  }

  async capabilities(input?: CapabilityProbeInput): Promise<ProviderCapabilities> {
    const yes = (notes?: string) => capability(true, "stable", notes);
    const beta = (notes?: string) => capability(true, "beta", notes);
    const unknown = (notes?: string) => capability(false, "unknown", notes);
    const runtime = input?.runtime ?? "local";
    const localCancellationLimitation =
      "Local @cursor/sdk cancellation currently returns cancelled but also emits a late unhandled Connect cancellation rejection in @cursor/sdk@1.0.17; metaharness disables portable local cancellation until that path is process-clean.";
    return {
      knownLimitations: [
        "Cursor SDK is treated as beta-sensitive; event mapping is defensive.",
        "Cloud behavior depends on Cursor-hosted runtime and explicit configuration.",
        "Native Cursor conversation state is provider-specific and not portable.",
        localCancellationLimitation,
        "Provider raw events are off by default and gated by metaharness storage settings."
      ],
      lifecycle: {
        cancel:
          runtime === "cloud"
            ? beta(
                "Cloud run cancellation is used when run.supports('cancel') allows it."
              )
            : unknown(localCancellationLimitation),
        fork: unknown("Cursor run forking is not exposed as a portable operation."),
        resume: beta(
          "Agent.resume(agentId) continues provider-native Cursor agent state when the SDK exposes it."
        ),
        start: yes("Agent.create starts a local or cloud Cursor agent."),
        stream: yes("run.stream() returns SDK messages when supported."),
        wait: yes("run.wait() returns a RunResult when supported.")
      },
      nativeVersion: "@cursor/sdk@^1.0.17",
      observability: {
        commandEvents: beta(
          "Command details are surfaced as tool/task events when present."
        ),
        cost: unknown("Cursor SDK RunResult does not expose portable cost."),
        diffEvents: beta("Diffs are captured by the core workspace manager."),
        fileChangeEvents: beta("File changes are captured by core git diff."),
        planEvents: beta("Task events map to plan.updated where possible."),
        rawEventAccess: yes("Raw SDK events are emitted through provider.raw."),
        tokenUsage: unknown("Cursor SDK docs do not expose token usage events."),
        toolCallEvents: yes("tool_call events map to portable tool events.")
      },
      policy: {
        commandAllowDeny: unknown(
          "Provider-native command allow/deny is not exposed through the portable adapter surface."
        ),
        filesystemSandbox: beta("Local sandboxOptions are forwarded when configured."),
        humanApprovals: beta("request events map to approval.requested."),
        networkControl: unknown("Network policy is runtime/provider-native."),
        providerNativePermissions: beta(
          "Cursor-native runtime controls are passed through."
        )
      },
      provider: "cursor",
      runtime: {
        cloud: beta(
          "Cloud mode is supported when explicit cloud config and API key are provided."
        ),
        local: yes("Local Agent.create({ local: { cwd } }) is supported."),
        selfHosted: unknown(
          "Self-hosted runtime is not exposed through the portable Cursor adapter surface."
        )
      },
      tools: {
        hooks: beta(
          "Cursor supports runtime hooks/skills provider-natively; metaharness passes native options through."
        ),
        mcp: yes("mcpServers are forwarded to Agent.create/send."),
        skills: beta("Cursor skills are provider-native."),
        subagents: beta("agents definitions are forwarded to Agent.create."),
        webSearch: unknown(
          "Web search is provider/model dependent and not a portable metaharness control."
        )
      },
      workspace: {
        artifacts: beta("Agent artifacts are mapped if listArtifacts is exposed."),
        gitBranch: beta("Cloud git branches are mapped from RunResult.git."),
        gitDiff: yes("The core workspace manager captures git diff after each run."),
        openPullRequest: beta("Cloud PR URLs are mapped from RunResult.git."),
        readFiles: yes("Cursor agent can inspect configured workspace files."),
        runCommands: beta(
          "Cursor agent may run tool-mediated commands depending on runtime."
        ),
        writeFiles: yes("Cursor agent can modify workspace files in local/cloud runtime.")
      }
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<CursorNativeSession>> {
    const { Agent } = await this.loadSdk();
    const runtime = resolveCursorRuntime(config);
    const agentOptions = buildCursorAgentOptions(config);
    const agent = await Agent.create(agentOptions);
    this.agents.add(agent);
    const agentId = getAgentId(agent);
    const handle: CursorSessionHandle = {
      createdAt: nowIso(),
      cwd: config.workspace.cwd,
      native: {
        agent,
        agentOptions,
        cwd: config.workspace.cwd,
        runtime
      },
      provider: "cursor",
      sessionId: createSessionId("cursor")
    };
    if (agentId) {
      handle.native.agentId = agentId;
      handle.nativeSessionId = agentId;
    }
    return handle;
  }

  async resumeSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<CursorNativeSession>> {
    if (!config.nativeSessionId) {
      return this.startSession(config);
    }

    const { Agent } = await this.loadSdk();
    const runtime = resolveCursorRuntime(config);
    const agentOptions = buildCursorAgentOptions(config);
    const agent =
      typeof Agent.resume === "function"
        ? await Agent.resume(config.nativeSessionId, agentOptions)
        : await Agent.create({
            ...agentOptions,
            agentId: config.nativeSessionId
          });
    this.agents.add(agent);
    const agentId = getAgentId(agent) ?? config.nativeSessionId;
    const handle: CursorSessionHandle = {
      createdAt: nowIso(),
      cwd: config.workspace.cwd,
      native: {
        agent,
        agentId,
        agentOptions,
        cwd: config.workspace.cwd,
        runtime
      },
      nativeSessionId: agentId,
      provider: "cursor",
      sessionId: config.sessionId ?? createSessionId("cursor")
    };
    if (agentId) {
      handle.native.agentId = agentId;
    }
    return handle;
  }

  async run(
    session: SessionHandle<CursorNativeSession>,
    input: RunInput
  ): Promise<RunHandle<CursorNativeRun>> {
    const sendOptions = buildCursorSendOptions(input);
    const nativeRun = await session.native.agent.send(input.task, sendOptions);
    const runId = createRunId("cursor");
    const native: CursorNativeRun = {
      agent: session.native.agent,
      completed: false,
      events: [],
      input,
      run: nativeRun,
      runtime: session.native.runtime,
      seq: 0,
      streamConsumed: false
    };
    const agentId = session.native.agentId;
    if (agentId) {
      native.agentId = agentId;
    }
    const cwd = input.workspace?.cwd ?? session.cwd ?? session.native.cwd;
    if (cwd) {
      native.cwd = cwd;
    }
    const handle: CursorRunHandle = {
      native,
      provider: "cursor",
      runId,
      sessionId: session.sessionId,
      startedAt: nowIso()
    };
    const nativeRunId = nativeRun.id;
    if (nativeRunId) {
      handle.nativeRunId = nativeRunId;
    }
    const nativeSessionId =
      session.nativeSessionId ?? nativeRun.agentId ?? session.native.agentId;
    if (nativeSessionId) {
      handle.nativeSessionId = nativeSessionId;
    }
    return handle;
  }

  async *stream(run: RunHandle<CursorNativeRun>): AsyncIterable<PortableRunEvent> {
    if (run.native.streamConsumed) {
      for (const event of run.native.events) {
        yield event;
      }
      return;
    }

    run.native.streamConsumed = true;
    yield createRunStartedEvent(run);
    yield createRunStatusEvent(run, "running");

    if (!operationSupported(run.native.run, "stream")) {
      yield createRunStatusEvent(
        run,
        "running",
        operationUnsupportedReason(run.native.run, "stream") ??
          "Cursor run streaming is unavailable; waiting for final result."
      );
      return;
    }

    try {
      const stream = run.native.run.stream?.();
      if (!stream) {
        yield createRunStatusEvent(run, "running", "Cursor run did not expose a stream.");
        return;
      }
      for await (const event of stream) {
        yield createRawProviderEvent(run, event, event.type);
        for (const mapped of mapCursorEvent(run, event)) {
          yield mapped;
        }
      }
    } catch (error) {
      if (isCursorCanceledError(error)) {
        yield createRunCompletedEvent(run, "cancelled", normalizeError(error).message, {
          finalMessage: normalizeError(error).message,
          status: "cancelled"
        });
        run.native.completed = true;
        return;
      }
      yield createErrorEvent(run, error);
      const normalized = normalizeError(error);
      yield createRunCompletedEvent(run, "failed", normalized.message, {
        finalMessage: normalized.message,
        status: "failed"
      });
      run.native.completed = true;
    }
  }

  async wait(run: RunHandle<CursorNativeRun>): Promise<RunResult> {
    const result: CursorRunResultLike =
      run.native.finalResult ??
      (operationSupported(run.native.run, "wait") && run.native.run.wait
        ? await run.native.run.wait()
        : runResultFromLiveRun(run.native.run));
    run.native.finalResult = result;
    run.native.completed = true;
    const mapped = mapCursorResultToRunResult(run, result);
    const artifacts = await readArtifacts(run.native.agent);
    if (artifacts.length > 0) {
      mapped.artifacts = [...mapped.artifacts, ...artifacts];
    }
    return mapped;
  }

  async cancel(run: RunHandle<CursorNativeRun>): Promise<void> {
    if (run.native.completed) {
      return;
    }
    if (run.native.runtime === "local") {
      throw new UnsupportedCapabilityError(
        "cursor",
        "cancel",
        "Portable Cursor local cancellation is disabled because @cursor/sdk@1.0.17 emits a late unhandled Connect cancellation rejection after run.cancel()."
      );
    }
    if (!operationSupported(run.native.run, "cancel") || !run.native.run.cancel) {
      throw new UnsupportedCapabilityError(
        "cursor",
        "cancel",
        operationUnsupportedReason(run.native.run, "cancel") ??
          "Cursor run does not support cancellation."
      );
    }
    try {
      await run.native.run.cancel();
    } catch (error) {
      if (!isCursorCanceledError(error)) {
        throw error;
      }
    }
    if (operationSupported(run.native.run, "wait") && run.native.run.wait) {
      try {
        run.native.finalResult = await run.native.run.wait();
      } catch (error) {
        if (!isCursorCanceledError(error)) {
          throw error;
        }
        run.native.finalResult = cursorCancelledResult(
          run.native.run,
          normalizeError(error).message
        );
      }
    } else {
      run.native.finalResult = cursorCancelledResult(
        run.native.run,
        "Cursor run was cancelled."
      );
    }
    run.native.completed = true;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.agents].map((agent) => disposeCursorAgent(agent)));
    this.agents.clear();
  }
}

async function disposeCursorAgent(agent: CursorAgentLike): Promise<void> {
  try {
    const asyncDispose = agent[Symbol.asyncDispose];
    if (typeof asyncDispose === "function") {
      await asyncDispose.call(agent);
      return;
    }
    if (typeof agent.close === "function") {
      await agent.close();
    }
  } catch (error) {
    if (!isCursorCanceledError(error)) {
      throw error;
    }
  }
}

function isCursorCanceledError(error: unknown): boolean {
  const normalized = normalizeError(error);
  const record =
    error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const rawMessage =
    typeof record.rawMessage === "string" ? record.rawMessage : normalized.message;
  const message = rawMessage.toLowerCase();
  return (
    message.includes("aborted") ||
    message.includes("canceled") ||
    message.includes("cancelled") ||
    record.code === 1 ||
    record.code === 20
  );
}

function cursorCancelledResult(
  run: CursorNativeRun["run"],
  message: string
): CursorRunResultLike {
  const result: CursorRunResultLike = {
    result: message,
    status: "cancelled"
  };
  if (run.id) {
    result.id = run.id;
  }
  return result;
}

function runResultFromLiveRun(run: CursorNativeRun["run"]): CursorRunResultLike {
  const result: CursorRunResultLike = {
    status: run.status === "running" || !run.status ? "error" : run.status
  };
  if (typeof run.durationMs === "number") {
    result.durationMs = run.durationMs;
  }
  if (run.git) {
    result.git = run.git;
  }
  if (run.id) {
    result.id = run.id;
  }
  if (run.model) {
    result.model = run.model;
  }
  if (run.result) {
    result.result = run.result;
  }
  return result;
}

async function defaultCursorSdkLoader(): Promise<CursorSdkModule> {
  try {
    return (await import("@cursor/sdk")) as unknown as CursorSdkModule;
  } catch (error) {
    throw new HarnessError(
      `Missing optional peer dependency "@cursor/sdk". Install it to use the Cursor adapter. ${normalizeError(error).message}`,
      "PROVIDER_SDK_MISSING"
    );
  }
}

function getAgentId(agent: CursorAgentLike): string | undefined {
  if (typeof agent.agentId === "string" && agent.agentId) {
    return agent.agentId;
  }
  if (typeof agent.id === "string" && agent.id) {
    return agent.id;
  }
  return undefined;
}

function operationSupported(
  run: CursorRunLikeForOps,
  operation: CursorRunOperationLike
): boolean {
  if (typeof run.supports === "function") {
    return run.supports(operation);
  }
  return typeof run[operation] === "function";
}

function operationUnsupportedReason(
  run: CursorRunLikeForOps,
  operation: CursorRunOperationLike
): string | undefined {
  return typeof run.unsupportedReason === "function"
    ? run.unsupportedReason(operation)
    : undefined;
}

async function readArtifacts(agent: CursorAgentLike): Promise<RunResult["artifacts"]> {
  if (typeof agent.listArtifacts !== "function") {
    return [];
  }
  try {
    return artifactsFromCursorArtifacts(await agent.listArtifacts());
  } catch {
    return [];
  }
}

type CursorRunLikeForOps = {
  cancel?: unknown;
  conversation?: unknown;
  stream?: unknown;
  supports?: (operation: CursorRunOperationLike) => boolean;
  unsupportedReason?: (operation: CursorRunOperationLike) => string | undefined;
  wait?: unknown;
};
