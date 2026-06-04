import {
  HarnessError,
  capability,
  createRunId,
  createSessionId,
  nowIso
} from "@metaharness/core";
import { buildClaudeBaseOptions, buildClaudeRunOptions } from "./map-config.js";
import type { ClaudeSessionConfigSnapshot } from "./map-config.js";
import {
  createErrorEvent,
  createRawProviderEvent,
  createRunCompletedEvent,
  createRunStartedEvent,
  createRunStatusEvent,
  mapClaudeMessageToEvents,
  mapClaudeResultToRunResult,
  normalizeError
} from "./map-events.js";
import type {
  ClaudeAdapterOptions,
  ClaudeNativeRun,
  ClaudeNativeSession,
  ClaudeRunHandle,
  ClaudeSdkLoader,
  ClaudeSdkMessageLike,
  ClaudeSdkModule,
  ClaudeSessionHandle
} from "./types.js";
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
} from "@metaharness/core";

export class ClaudeAdapter implements CodingAgentAdapter<
  ClaudeNativeSession,
  ClaudeNativeRun
> {
  readonly provider = "claude" as const;
  readonly version = "0.1.0";

  private readonly loadSdk: ClaudeSdkLoader;

  constructor(options: ClaudeAdapterOptions = {}) {
    this.loadSdk = options.loadSdk ?? defaultClaudeSdkLoader;
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const yes = (notes?: string) => capability(true, "stable", notes);
    const beta = (notes?: string) => capability(true, "beta", notes);
    const unknown = (notes?: string) => capability(false, "unknown", notes);
    return {
      knownLimitations: [
        "The SDK spawns and controls Claude Code subprocess behavior.",
        "Native Claude session state is provider-local and not portable.",
        "Filesystem state must be captured through the metaharness ledger and git diff.",
        "Provider raw events are off by default and gated by metaharness storage settings."
      ],
      lifecycle: {
        cancel: beta("Cancellation is forwarded through the SDK AbortController."),
        fork: beta("Claude supports forkSession when resuming native sessions."),
        resume: yes("The SDK supports resume by native session id."),
        start: yes("query() starts a Claude Agent SDK session."),
        stream: yes("query() returns an async generator of SDK messages."),
        wait: yes("The final result message is mapped to RunResult.")
      },
      nativeVersion: "@anthropic-ai/claude-agent-sdk@^0.3.161",
      observability: {
        commandEvents: beta("Command activity is surfaced through tool and hook events."),
        cost: yes("Result messages include total_cost_usd."),
        diffEvents: beta("Diffs are captured by the core workspace manager."),
        fileChangeEvents: beta("File changes are captured by hooks and core git diff."),
        planEvents: unknown("Claude SDK does not expose a stable portable plan event."),
        rawEventAccess: yes("Raw provider messages are emitted through provider.raw."),
        tokenUsage: yes("Assistant/result usage maps to portable usage."),
        toolCallEvents: yes(
          "Tool use and tool result blocks map to portable tool events."
        )
      },
      policy: {
        commandAllowDeny: yes(
          "Bash commands are checked through metaharness policy canUseTool."
        ),
        filesystemSandbox: beta(
          "Claude permission mode, allowed tools, and sandbox options are forwarded."
        ),
        humanApprovals: yes(
          "Permission hooks and denials map to approval events where exposed."
        ),
        networkControl: beta(
          "Network restrictions are provider-native and policy driven."
        ),
        providerNativePermissions: yes(
          "canUseTool, hooks, and permissionMode are forwarded."
        )
      },
      provider: "claude",
      runtime: {
        cloud: unknown(
          "Managed/cloud agents are provider-native and are not exposed as a portable Claude adapter runtime."
        ),
        local: yes("Claude Agent SDK runs locally through Claude Code."),
        selfHosted: beta("The local SDK can be run in a self-hosted container/process.")
      },
      tools: {
        hooks: yes("Claude Agent SDK exposes hooks."),
        mcp: yes("Claude Agent SDK supports MCP servers."),
        skills: yes("Claude Agent SDK supports provider-native skills/plugins."),
        subagents: yes("Claude Agent SDK supports subagents."),
        webSearch: yes("Web tools are provider-native Claude tools when available.")
      },
      workspace: {
        artifacts: unknown(
          "No stable portable artifact store is exposed by the Claude SDK surface."
        ),
        gitBranch: beta("Possible through Bash/git; not a direct SDK primitive."),
        gitDiff: yes("The core workspace manager captures git diff after each run."),
        openPullRequest: unknown("Possible through gh/MCP, not a direct SDK primitive."),
        readFiles: yes("Claude built-in tools can read workspace files."),
        runCommands: yes("Claude Bash tool can run commands when policy allows it."),
        writeFiles: yes("Claude edit/write tools can modify workspace files.")
      }
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<ClaudeNativeSession>> {
    const { query } = await this.loadSdk();
    const baseOptions = buildClaudeBaseOptions(config);
    const handle: ClaudeSessionHandle = {
      createdAt: nowIso(),
      cwd: config.workspace.cwd,
      native: {
        baseOptions,
        cwd: config.workspace.cwd,
        mode: "sdk",
        query
      },
      provider: "claude",
      sessionId: createSessionId("claude")
    };
    if (typeof baseOptions.sessionId === "string") {
      handle.nativeSessionId = baseOptions.sessionId;
    }
    return handle;
  }

  async resumeSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<ClaudeNativeSession>> {
    const { query } = await this.loadSdk();
    const baseOptions = buildClaudeBaseOptions(config);
    const handle: ClaudeSessionHandle = {
      createdAt: nowIso(),
      cwd: config.workspace.cwd,
      native: {
        baseOptions,
        cwd: config.workspace.cwd,
        mode: "sdk",
        query
      },
      provider: "claude",
      sessionId: config.sessionId ?? createSessionId("claude")
    };
    const nativeSessionId = config.nativeSessionId ?? baseOptions.resume;
    if (nativeSessionId) {
      handle.nativeSessionId = nativeSessionId;
    }
    return handle;
  }

  async run(
    session: SessionHandle<ClaudeNativeSession>,
    input: RunInput
  ): Promise<RunHandle<ClaudeNativeRun>> {
    const abortController = new AbortController();
    const runId = createRunId("claude");
    const sessionConfig: ClaudeSessionConfigSnapshot = {
      cwd: input.workspace?.cwd ?? session.cwd ?? session.native.cwd,
      native: session.native.baseOptions
    };
    const model = optionsModel(session.native.baseOptions);
    if (model) {
      sessionConfig.model = model;
    }
    if (session.nativeSessionId) {
      sessionConfig.nativeSessionId = session.nativeSessionId;
    }
    const runOptionsInput: Parameters<typeof buildClaudeRunOptions>[0] = {
      abortController,
      runInput: input,
      sessionConfig
    };
    if (session.nativeSessionId) {
      runOptionsInput.sessionNativeId = session.nativeSessionId;
    }
    const options = await buildClaudeRunOptions(runOptionsInput);
    const query = session.native.query({
      options,
      prompt: input.task
    });
    const nativeRun: ClaudeNativeRun = {
      abortController,
      completed: false,
      cwd: options.cwd ?? input.workspace?.cwd ?? session.cwd ?? session.native.cwd,
      events: [],
      input,
      mode: "sdk",
      options,
      query,
      seq: 0,
      streamConsumed: false
    };
    const run: ClaudeRunHandle = {
      native: nativeRun,
      provider: "claude",
      runId,
      sessionId: session.sessionId,
      startedAt: nowIso()
    };
    if (session.nativeSessionId) {
      run.nativeSessionId = session.nativeSessionId;
    }
    return run;
  }

  async *stream(run: RunHandle<ClaudeNativeRun>): AsyncIterable<PortableRunEvent> {
    if (run.native.streamConsumed) {
      for (const event of run.native.events) {
        yield event;
      }
      return;
    }

    run.native.streamConsumed = true;
    yield createRunStartedEvent(run);
    yield createRunStatusEvent(run, "running");

    let completed = false;
    try {
      for await (const message of run.native.query) {
        const providerEventType = providerEventTypeFor(message);
        yield createRawProviderEvent(run, message, providerEventType);
        for (const event of mapClaudeMessageToEvents(run, message)) {
          if (event.type === "run.completed") {
            completed = true;
          }
          yield event;
        }
      }
      if (!completed) {
        run.native.finalStatus = "success";
        yield createRunCompletedEvent(run, "success", undefined, {
          status: "success"
        });
      }
      run.native.completed = true;
    } catch (error) {
      const status = run.native.abortController.signal.aborted ? "cancelled" : "failed";
      run.native.finalStatus = status;
      yield createErrorEvent(run, error);
      const normalized = normalizeError(error);
      yield createRunCompletedEvent(run, status, normalized.message, {
        finalMessage: normalized.message,
        status
      });
      run.native.completed = true;
    }
  }

  async wait(run: RunHandle<ClaudeNativeRun>): Promise<RunResult> {
    if (!run.native.completed) {
      for await (const event of this.stream(run)) {
        void event;
      }
    }
    return mapClaudeResultToRunResult(run);
  }

  async cancel(run: RunHandle<ClaudeNativeRun>): Promise<void> {
    if (run.native.completed) {
      return;
    }
    run.native.abortController.abort();
    run.native.query.close?.();
  }
}

async function defaultClaudeSdkLoader(): Promise<ClaudeSdkModule> {
  try {
    return (await import("@anthropic-ai/claude-agent-sdk")) as ClaudeSdkModule;
  } catch (error) {
    throw new HarnessError(
      `Missing optional peer dependency "@anthropic-ai/claude-agent-sdk". Install it to use the Claude adapter. ${normalizeError(error).message}`,
      "PROVIDER_SDK_MISSING"
    );
  }
}

function providerEventTypeFor(message: ClaudeSdkMessageLike): string {
  if ("subtype" in message && typeof message.subtype === "string") {
    return `${message.type}.${message.subtype}`;
  }
  return message.type;
}

function optionsModel(options: { model?: unknown }): string | undefined {
  return typeof options.model === "string" ? options.model : undefined;
}
