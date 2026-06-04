import {
  UnsupportedCapabilityError,
  capability,
  createRunId,
  createSessionId,
  nowIso
} from "@metaharness/core";
import {
  buildCodexAppServerClientConfig,
  buildCodexAppServerThreadResumeParams,
  buildCodexAppServerThreadStartParams,
  buildCodexAppServerTurnStartParams,
  buildCodexOptions,
  buildCodexThreadOptions,
  buildCodexTurnOptions,
  resolveCodexMode
} from "./map-config.js";
import { CodexAppServerClient } from "./appserver/client.js";
import {
  createAppServerApprovalResolvedEvent,
  createAppServerErrorEvent,
  createAppServerRawProviderEvent,
  createAppServerRunCompletedEvent,
  createAppServerRunStartedEvent,
  createAppServerRunStatusEvent,
  mapCodexAppServerNotification,
  mapCodexAppServerRequest,
  mapCodexAppServerResultToRunResult,
  normalizeAppServerError,
  providerEventType,
  resolveCodexAppServerRequest,
  synthesizeCodexTurnFromAppServerEvents
} from "./appserver/map-events.js";
import { isAppServerRequest } from "./appserver/protocol.js";
import {
  createErrorEvent,
  createRawProviderEvent,
  createRunCompletedEvent,
  createRunStartedEvent,
  createRunStatusEvent,
  getFinalResponse,
  mapCodexResultToRunResult,
  mapCodexThreadEvent,
  mapCodexTurnResult,
  normalizeUsage,
  normalizeError
} from "./map-events.js";
import type {
  CodexAdapterOptions,
  CodexNativeRun,
  CodexNativeSession,
  CodexAppServerNativeRun,
  CodexAppServerNativeSession,
  CodexAppServerClientLike,
  CodexSdkNativeRun,
  CodexSdkNativeSession,
  CodexSdkLoader,
  CodexSdkModule,
  CodexThreadLike,
  CodexTurnLike
} from "./types.js";
import type {
  CodingAgentAdapter,
  PortableRunEvent,
  ProviderCapabilities,
  ResumeSessionConfig,
  RunInput,
  RunHandle,
  RunResult,
  SessionHandle,
  StartSessionConfig
} from "@metaharness/core";

export class CodexAdapter implements CodingAgentAdapter<
  CodexNativeSession,
  CodexNativeRun
> {
  readonly provider = "codex" as const;
  readonly version = "0.1.0";

  private readonly loadSdk: CodexSdkLoader;
  private readonly appServerClientFactory: NonNullable<
    CodexAdapterOptions["appServerClientFactory"]
  >;
  private readonly appServerApprovalResolver: NonNullable<
    CodexAdapterOptions["appServerApprovalResolver"]
  >;
  private readonly appServerClients = new Set<CodexAppServerClientLike>();

  constructor(options: CodexAdapterOptions = {}) {
    this.loadSdk = options.loadSdk ?? defaultCodexSdkLoader;
    this.appServerClientFactory =
      options.appServerClientFactory ?? defaultCodexAppServerClientFactory;
    this.appServerApprovalResolver =
      options.appServerApprovalResolver ??
      ((context) => resolveCodexAppServerRequest(context.request));
  }

  async capabilities(): Promise<ProviderCapabilities> {
    const yes = (notes?: string) => capability(true, "stable", notes);
    const beta = (notes?: string) => capability(true, "beta", notes);
    const unknown = (notes?: string) => capability(false, "unknown", notes);
    return {
      provider: "codex",
      runtime: {
        local: yes("Codex SDK and explicit app-server mode run local Codex threads."),
        cloud: unknown("Cloud behavior is provider-native and not exposed by SDK mode."),
        selfHosted: unknown()
      },
      lifecycle: {
        cancel: beta(
          "SDK mode forwards AbortSignal; app-server mode uses turn/interrupt."
        ),
        fork: unknown("Native thread forking is not exposed by SDK mode."),
        resume: yes(
          "SDK resumeThread(id) or app-server thread/resume resumes provider-native Codex thread state."
        ),
        start: yes(
          "SDK startThread() or app-server thread/start starts a native Codex thread."
        ),
        stream: yes("SDK runStreamed() or app-server notifications provide events."),
        wait: yes("run() returns a completed turn.")
      },
      observability: {
        commandEvents: yes(
          "SDK command_execution items and app-server commandExecution notifications map to portable command events."
        ),
        cost: unknown("The SDK exposes usage but not cost."),
        diffEvents: yes(
          "app-server turn/diff/updated maps directly; core also captures git diff."
        ),
        fileChangeEvents: yes(
          "SDK file_change items and app-server fileChange notifications map to portable file events."
        ),
        planEvents: yes(
          "SDK todo_list items and app-server turn/plan/updated notifications map to portable plan events."
        ),
        rawEventAccess: yes(
          "Raw provider events are emitted only when raw storage is enabled."
        ),
        tokenUsage: yes(
          "SDK turn usage and app-server thread/tokenUsage/updated map to portable usage."
        ),
        toolCallEvents: yes(
          "MCP, web search, and dynamic tools map to portable tool events."
        )
      },
      policy: {
        commandAllowDeny: beta(
          "Codex enforcement remains provider-native; metaharness records policy context."
        ),
        filesystemSandbox: yes(
          "sandboxMode supports read-only, workspace-write, and danger-full-access."
        ),
        humanApprovals: beta(
          "approvalPolicy is forwarded; app-server approval requests are surfaced and resolved through an optional resolver that declines by default."
        ),
        networkControl: beta(
          "networkAccessEnabled and web search options are forwarded."
        ),
        providerNativePermissions: beta(
          "Provider-native approval policy is exposed through native options."
        )
      },
      tools: {
        hooks: unknown("SDK mode does not expose hooks as a portable metaharness API."),
        mcp: yes(
          "Codex supports MCP; metaharness passes provider-native MCP behavior through."
        ),
        skills: beta(
          "Codex skills are provider-native, not reimplemented by metaharness."
        ),
        subagents: unknown(
          "SDK mode does not expose subagents as a portable metaharness API."
        ),
        webSearch: yes(
          "app-server webSearch items and SDK web search config are supported."
        )
      },
      workspace: {
        artifacts: unknown("SDK mode does not expose a stable portable artifact store."),
        gitBranch: unknown("Branch creation is not implemented by the Codex adapter."),
        gitDiff: yes("The core workspace manager captures git diff after each run."),
        openPullRequest: unknown("Pull request creation is not exposed by SDK mode."),
        readFiles: yes("Codex can inspect files in the configured working directory."),
        runCommands: yes("Codex can run provider-mediated commands in the sandbox."),
        writeFiles: yes("Codex can modify files according to sandbox settings.")
      },
      knownLimitations: [
        "SDK mode exposes less event detail than explicit Codex app-server mode.",
        "Codex app-server mode is version-sensitive; metaharness maps known v2 method names defensively.",
        "Native Codex thread state is provider-local and not portable across providers.",
        "Handoff must use the metaharness SessionLedger and diff rather than hidden provider session transfer.",
        "Provider raw events are off by default and gated by metaharness storage settings."
      ],
      nativeVersion: "@openai/codex-sdk@^0.136.0"
    };
  }

  async startSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<CodexNativeSession>> {
    if (resolveCodexMode(config) === "app-server") {
      return this.startAppServerSession(config);
    }
    return this.startSdkSession(config);
  }

  async resumeSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<CodexNativeSession>> {
    if (resolveCodexMode(config) === "app-server") {
      return this.resumeAppServerSession(config);
    }
    return this.resumeSdkSession(config);
  }

  async run(
    session: SessionHandle<CodexNativeSession>,
    input: RunInput
  ): Promise<RunHandle<CodexNativeRun>> {
    if (session.native.mode === "app-server") {
      return this.runAppServer(
        session as SessionHandle<CodexAppServerNativeSession>,
        input
      );
    }
    return this.runSdk(session as SessionHandle<CodexSdkNativeSession>, input);
  }

  async *stream(run: RunHandle<CodexNativeRun>): AsyncIterable<PortableRunEvent> {
    if (run.native.mode === "app-server") {
      yield* this.streamAppServer(run as RunHandle<CodexAppServerNativeRun>);
      return;
    }
    yield* this.streamSdk(run as RunHandle<CodexSdkNativeRun>);
  }

  async wait(run: RunHandle<CodexNativeRun>): Promise<RunResult> {
    if (run.native.mode === "app-server") {
      return this.waitAppServer(run as RunHandle<CodexAppServerNativeRun>);
    }
    return this.waitSdk(run as RunHandle<CodexSdkNativeRun>);
  }

  async cancel(run: RunHandle<CodexNativeRun>): Promise<void> {
    if (run.native.mode === "app-server") {
      await this.cancelAppServer(run as RunHandle<CodexAppServerNativeRun>);
      return;
    }
    await this.cancelSdk(run as RunHandle<CodexSdkNativeRun>);
  }

  private async startSdkSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<CodexSdkNativeSession>> {
    const codexOptions = buildCodexOptions(config);
    const threadOptions = buildCodexThreadOptions(config);
    const { Codex } = await this.loadSdk();
    const client = new Codex(codexOptions);
    const thread = await client.startThread(threadOptions);
    const handle: SessionHandle<CodexSdkNativeSession> = {
      cwd: config.workspace.cwd,
      createdAt: nowIso(),
      native: {
        client,
        cwd: config.workspace.cwd,
        mode: "sdk",
        thread,
        threadOptions
      },
      provider: "codex",
      sessionId: createSessionId("codex")
    };
    const nativeSessionId = getThreadId(thread);
    if (nativeSessionId) {
      handle.nativeSessionId = nativeSessionId;
    }
    return handle;
  }

  private async resumeSdkSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<CodexSdkNativeSession>> {
    if (!config.nativeSessionId) {
      throw new UnsupportedCapabilityError(
        "codex",
        "resume",
        "Codex resume requires a nativeSessionId from a prior Codex thread."
      );
    }
    const codexOptions = buildCodexOptions(config);
    const threadOptions = buildCodexThreadOptions(config);
    const { Codex } = await this.loadSdk();
    const client = new Codex(codexOptions);
    const thread = await client.resumeThread(config.nativeSessionId, threadOptions);
    return {
      cwd: config.workspace.cwd,
      createdAt: nowIso(),
      native: {
        client,
        cwd: config.workspace.cwd,
        mode: "sdk",
        thread,
        threadOptions
      },
      nativeSessionId: config.nativeSessionId,
      provider: "codex",
      sessionId: config.sessionId ?? createSessionId("codex")
    };
  }

  private async runSdk(
    session: SessionHandle<CodexSdkNativeSession>,
    input: RunInput
  ): Promise<RunHandle<CodexSdkNativeRun>> {
    const abortController = new AbortController();
    const runId = createRunId("codex");
    const turnOptions = buildCodexTurnOptions(input, abortController);
    const nativeRun: CodexSdkNativeRun = {
      abortController,
      completed: false,
      cwd: input.workspace?.cwd ?? session.cwd ?? session.native.cwd,
      events: [],
      input,
      mode: "sdk",
      seq: 0,
      streamConsumed: false,
      thread: session.native.thread
    };
    const run: RunHandle<CodexSdkNativeRun> = {
      native: nativeRun,
      provider: "codex",
      runId,
      sessionId: session.sessionId,
      startedAt: nowIso()
    };
    const threadId = session.nativeSessionId ?? getThreadId(session.native.thread);
    if (threadId) {
      run.nativeSessionId = threadId;
    }

    if (typeof session.native.thread.runStreamed === "function") {
      const streamed = await session.native.thread.runStreamed(input.task, turnOptions);
      nativeRun.streamedEvents = streamed.events;
    } else {
      nativeRun.resultPromise = session.native.thread.run(input.task, turnOptions);
    }

    return run;
  }

  private async *streamSdk(
    run: RunHandle<CodexSdkNativeRun>
  ): AsyncIterable<PortableRunEvent> {
    if (run.native.streamConsumed) {
      for (const event of run.native.events) {
        yield event;
      }
      return;
    }

    run.native.streamConsumed = true;

    yield createRunStartedEvent(run);
    yield createRunStatusEvent(run, "running");

    try {
      if (run.native.streamedEvents) {
        yield* this.streamNativeEvents(run);
      } else {
        const turn = await this.waitForNativeResult(run);
        yield createRawProviderEvent(run, turn, "turn.completed");
        for (const event of mapCodexTurnResult(run, turn)) {
          yield event;
        }
      }
    } catch (error) {
      yield createErrorEvent(run, error);
      const normalized = normalizeError(error);
      yield createRunCompletedEvent(run, "failed", normalized.message, {
        finalMessage: normalized.message,
        status: "failed"
      });
      run.native.finalResult = {
        finalResponse: normalized.message,
        usage: null
      };
      run.native.completed = true;
    }
  }

  private async waitSdk(run: RunHandle<CodexSdkNativeRun>): Promise<RunResult> {
    if (!run.native.completed) {
      if (run.native.streamConsumed) {
        await this.waitForNativeResult(run);
      } else {
        for await (const event of this.stream(run)) {
          void event;
          // Drains the native stream so wait() can return a completed result.
        }
      }
    }
    return mapCodexResultToRunResult(run, run.native.finalResult);
  }

  private async cancelSdk(run: RunHandle<CodexSdkNativeRun>): Promise<void> {
    if (run.native.completed) {
      return;
    }
    run.native.abortController.abort();
  }

  private async startAppServerSession(
    config: StartSessionConfig
  ): Promise<SessionHandle<CodexAppServerNativeSession>> {
    const clientConfig = buildCodexAppServerClientConfig(config);
    const client = await this.appServerClientFactory(clientConfig);
    this.appServerClients.add(client);
    await client.initialize({
      clientInfo: {
        name: "metaharness",
        title: "metaharness",
        version: this.version
      }
    });
    const threadOptions = buildCodexAppServerThreadStartParams(config);
    const response = await client.startThread(threadOptions);
    const thread = response.thread ?? {
      cwd: config.workspace.cwd
    };
    const handle: SessionHandle<CodexAppServerNativeSession> = {
      cwd: config.workspace.cwd,
      createdAt: nowIso(),
      native: {
        client,
        clientConfig,
        cwd: config.workspace.cwd,
        mode: "app-server",
        thread,
        threadOptions
      },
      provider: "codex",
      sessionId: createSessionId("codex")
    };
    const nativeSessionId = getAppServerThreadId(thread);
    if (nativeSessionId) {
      handle.nativeSessionId = nativeSessionId;
    }
    return handle;
  }

  private async resumeAppServerSession(
    config: ResumeSessionConfig
  ): Promise<SessionHandle<CodexAppServerNativeSession>> {
    if (!config.nativeSessionId) {
      throw new UnsupportedCapabilityError(
        "codex",
        "resume",
        "Codex app-server resume requires a nativeSessionId from a prior Codex thread."
      );
    }
    const clientConfig = buildCodexAppServerClientConfig(config);
    const client = await this.appServerClientFactory(clientConfig);
    this.appServerClients.add(client);
    await client.initialize({
      clientInfo: {
        name: "metaharness",
        title: "metaharness",
        version: this.version
      }
    });
    const threadOptions = buildCodexAppServerThreadResumeParams(
      config,
      config.nativeSessionId
    );
    const response = await client.resumeThread(threadOptions);
    const thread = response.thread ?? {
      cwd: config.workspace.cwd,
      id: config.nativeSessionId
    };
    return {
      cwd: config.workspace.cwd,
      createdAt: nowIso(),
      native: {
        client,
        clientConfig,
        cwd: config.workspace.cwd,
        mode: "app-server",
        thread,
        threadOptions
      },
      nativeSessionId: getAppServerThreadId(thread) ?? config.nativeSessionId,
      provider: "codex",
      sessionId: config.sessionId ?? createSessionId("codex")
    };
  }

  private async runAppServer(
    session: SessionHandle<CodexAppServerNativeSession>,
    input: RunInput
  ): Promise<RunHandle<CodexAppServerNativeRun>> {
    const threadId =
      session.nativeSessionId ?? getAppServerThreadId(session.native.thread);
    if (!threadId) {
      throw new UnsupportedCapabilityError(
        "codex",
        "run",
        "Codex app-server run requires a native thread id."
      );
    }
    const runId = createRunId("codex");
    const turnParams = buildCodexAppServerTurnStartParams(threadId, input);
    const response = await session.native.client.startTurn(turnParams);
    const turn = response.turn;
    const nativeRun: CodexAppServerNativeRun = {
      assistantTextByItem: {},
      client: session.native.client,
      completed: false,
      cwd: input.workspace?.cwd ?? session.cwd ?? session.native.cwd,
      events: [],
      input,
      mode: "app-server",
      seq: 0,
      streamConsumed: false,
      threadId
    };
    if (turn) {
      nativeRun.finalTurn = turn;
    }
    if (turn?.id) {
      nativeRun.turnId = turn.id;
    }
    const run: RunHandle<CodexAppServerNativeRun> = {
      native: nativeRun,
      nativeSessionId: threadId,
      provider: "codex",
      runId,
      sessionId: session.sessionId,
      startedAt: nowIso()
    };
    if (turn?.id) {
      run.nativeRunId = turn.id;
    }
    return run;
  }

  private async *streamAppServer(
    run: RunHandle<CodexAppServerNativeRun>
  ): AsyncIterable<PortableRunEvent> {
    if (run.native.streamConsumed) {
      for (const event of run.native.events) {
        yield event;
      }
      return;
    }

    run.native.streamConsumed = true;
    yield createAppServerRunStartedEvent(run);
    yield createAppServerRunStatusEvent(run, "running");

    try {
      for await (const message of run.native.client.events()) {
        yield createAppServerRawProviderEvent(run, message, providerEventType(message));
        if (isAppServerRequest(message)) {
          const approvalEvents = mapCodexAppServerRequest(run, message);
          const approval = approvalEvents.find(
            (event) => event.type === "approval.requested"
          );
          for (const event of approvalEvents) {
            yield event;
          }
          const resolution = await this.appServerApprovalResolver({
            approval: approval ?? createFallbackAppServerApproval(run, message),
            request: message
          });
          if (resolution.error && run.native.client.respondError) {
            await run.native.client.respondError(message.id, resolution.error);
          } else {
            await run.native.client.respond(
              message.id,
              resolution.result ?? defaultAppServerApprovalResponse(resolution.decision)
            );
          }
          yield createAppServerApprovalResolvedEvent(
            run,
            message.id,
            resolution.decision
          );
          continue;
        }
        for (const event of mapCodexAppServerNotification(run, message)) {
          yield event;
        }
        if (run.native.completed) {
          return;
        }
      }
      if (!run.native.completed) {
        const message = "Codex app-server stream ended before turn/completed.";
        yield createAppServerErrorEvent(run, message);
        yield createAppServerRunCompletedEvent(run, "failed", message, {
          finalMessage: message,
          status: "failed"
        });
        run.native.result = {
          finalMessage: message,
          status: "failed"
        };
        run.native.finalResult = {
          finalResponse: message,
          usage: null
        };
        run.native.completed = true;
      }
    } catch (error) {
      yield createAppServerErrorEvent(run, error);
      const normalized = normalizeAppServerError(error);
      yield createAppServerRunCompletedEvent(run, "failed", normalized.message, {
        finalMessage: normalized.message,
        status: "failed"
      });
      run.native.result = {
        finalMessage: normalized.message,
        status: "failed"
      };
      run.native.finalResult = {
        finalResponse: normalized.message,
        usage: null
      };
      run.native.completed = true;
    }
  }

  private async waitAppServer(
    run: RunHandle<CodexAppServerNativeRun>
  ): Promise<RunResult> {
    if (!run.native.completed) {
      for await (const event of this.stream(run)) {
        void event;
      }
    }
    if (!run.native.finalResult) {
      run.native.finalResult = synthesizeCodexTurnFromAppServerEvents(run);
    }
    return mapCodexAppServerResultToRunResult(run);
  }

  private async cancelAppServer(run: RunHandle<CodexAppServerNativeRun>): Promise<void> {
    if (run.native.completed) {
      return;
    }
    if (!run.native.turnId) {
      throw new UnsupportedCapabilityError(
        "codex",
        "cancel",
        "Codex app-server cancellation requires an active turn id."
      );
    }
    await run.native.client.interruptTurn(run.native.threadId, run.native.turnId);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.appServerClients].map((client) => client.close()));
    this.appServerClients.clear();
  }

  private async *streamNativeEvents(
    run: RunHandle<CodexSdkNativeRun>
  ): AsyncIterable<PortableRunEvent> {
    let completed = false;
    for await (const providerEvent of run.native.streamedEvents ?? []) {
      yield createRawProviderEvent(run, providerEvent, providerEvent.type);
      for (const event of mapCodexThreadEvent(run, providerEvent)) {
        if (event.type === "run.completed") {
          completed = true;
        }
        yield event;
      }
      if (providerEvent.type === "turn.completed") {
        run.native.finalResult = synthesizeTurnFromEvents(
          run,
          normalizeUsage(providerEvent.usage) ?? null
        );
      }
      if (providerEvent.type === "turn.failed" || providerEvent.type === "error") {
        run.native.completed = true;
        return;
      }
    }

    if (!run.native.finalResult) {
      run.native.finalResult = synthesizeTurnFromEvents(run, null);
    }

    if (!completed) {
      const finalMessage = getFinalResponse(run.native.finalResult);
      const result: Partial<RunResult> = {
        status: "success"
      };
      if (finalMessage) {
        result.finalMessage = finalMessage;
      }
      if (run.native.finalResult.usage) {
        const usage = mapCodexResultToRunResult(run, run.native.finalResult).usage;
        if (usage) {
          result.usage = usage;
        }
      }
      yield createRunCompletedEvent(run, "success", finalMessage, result);
    }
    run.native.completed = true;
  }

  private async waitForNativeResult(
    run: RunHandle<CodexSdkNativeRun>
  ): Promise<CodexTurnLike> {
    if (!run.native.finalResult) {
      if (!run.native.resultPromise) {
        run.native.finalResult = synthesizeTurnFromEvents(run, null);
      } else {
        run.native.finalResult = await run.native.resultPromise;
      }
      const threadId = getThreadId(run.native.thread);
      if (threadId) {
        run.nativeSessionId = threadId;
      }
    }
    run.native.completed = true;
    return run.native.finalResult;
  }
}

function createFallbackAppServerApproval(
  run: RunHandle<CodexAppServerNativeRun>,
  request: Parameters<typeof resolveCodexAppServerRequest>[0]
): Extract<PortableRunEvent, { type: "approval.requested" }> {
  return {
    approvalId: String(request.id),
    availableDecisions: ["cancel"],
    category: "provider_native",
    id: `${run.runId}-approval-fallback-${String(request.id)}`,
    native: {
      method: request.method,
      params: request.params
    },
    provider: "codex",
    reason: `Codex app-server requested ${request.method}.`,
    runId: run.runId,
    seq: run.native.seq + 1,
    sessionId: run.sessionId,
    ts: nowIso(),
    type: "approval.requested"
  };
}

function defaultAppServerApprovalResponse(
  decision: Extract<PortableRunEvent, { type: "approval.resolved" }>["decision"]
): { decision: string } {
  return {
    decision: decision === "accept_for_session" ? "acceptForSession" : decision
  };
}

async function defaultCodexSdkLoader() {
  return (await import("@openai/codex-sdk")) as CodexSdkModule;
}

async function defaultCodexAppServerClientFactory(
  config: Parameters<NonNullable<CodexAdapterOptions["appServerClientFactory"]>>[0]
) {
  return CodexAppServerClient.start(config);
}

function getThreadId(thread: CodexThreadLike): string | undefined {
  if (typeof thread.id === "string" && thread.id) {
    return thread.id;
  }
  if (typeof thread.threadId === "string" && thread.threadId) {
    return thread.threadId;
  }
  return undefined;
}

function getAppServerThreadId(thread: { id?: string } | undefined): string | undefined {
  return typeof thread?.id === "string" && thread.id ? thread.id : undefined;
}

function synthesizeTurnFromEvents(
  run: RunHandle<CodexSdkNativeRun>,
  usage: CodexTurnLike["usage"]
): CodexTurnLike {
  const assistantMessages = run.native.events
    .filter((event) => event.type === "assistant.message.completed")
    .map((event) => event.text);
  const finalResponse = assistantMessages.at(-1) ?? "";
  const turn: CodexTurnLike = {
    finalResponse,
    items: []
  };
  if (usage !== undefined) {
    turn.usage = usage;
  }
  return turn;
}
