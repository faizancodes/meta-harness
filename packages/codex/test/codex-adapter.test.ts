import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  ProviderConfigError,
  UnsupportedCapabilityError,
  createHarness
} from "@metaharness/core";
import { CodexAdapter, mapCodexSandboxMode } from "../src/index.js";
import type {
  CodexAppServerClientConfig,
  CodexAppServerClientFactory,
  CodexAppServerClientLike,
  CodexAppServerInboundMessage,
  CodexAppServerInitializeParams,
  CodexAppServerJsonRpcId,
  CodexAppServerThreadResponseLike,
  CodexAppServerThreadResumeParamsLike,
  CodexAppServerThreadStartParamsLike,
  CodexAppServerTurnResponseLike,
  CodexAppServerTurnStartParamsLike,
  CodexClientLike,
  CodexInputLike,
  CodexOptionsLike,
  CodexSdkLoader,
  CodexThreadEventLike,
  CodexThreadLike,
  CodexThreadOptionsLike,
  CodexTurnLike,
  CodexTurnOptionsLike
} from "../src/index.js";
import type { PortableRunEvent } from "@metaharness/core";

const execFileAsync = promisify(execFile);

describe("CodexAdapter", () => {
  it("reports an honest SDK-mode capability matrix", async () => {
    const { loadSdk } = createFakeCodexLoader();
    const capabilities = await new CodexAdapter({ loadSdk }).capabilities();

    expect(capabilities.provider).toBe("codex");
    expect(capabilities.lifecycle.start.supported).toBe(true);
    expect(capabilities.lifecycle.resume.supported).toBe(true);
    expect(capabilities.workspace.gitDiff.notes).toContain("core workspace manager");
    expect(capabilities.lifecycle.fork.supported).toBe(false);
  });

  it("starts a session and synthesizes portable events when runStreamed is unavailable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-fallback-"));
    const { loadSdk, state } = createFakeCodexLoader();
    const adapter = new CodexAdapter({ loadSdk });

    const session = await adapter.startSession({
      auth: {
        apiKey: "test-key"
      },
      model: "gpt-5-codex",
      native: {
        sandbox: "full-access"
      },
      provider: "codex",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "summarize this repo",
      workspace: {
        cwd
      }
    });
    const events = await collect(adapter.stream(run));
    const result = await adapter.wait(run);

    expect(state.clients[0]?.options?.apiKey).toBe("test-key");
    expect(state.clients[0]?.startedThreadOptions).toMatchObject({
      model: "gpt-5-codex",
      sandboxMode: "danger-full-access",
      skipGitRepoCheck: true,
      workingDirectory: cwd
    });
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "provider.raw",
      "assistant.message.completed",
      "usage.updated",
      "run.completed"
    ]);
    expect(result.status).toBe("success");
    expect(result.finalMessage).toBe("Codex completed: summarize this repo");
    expect(result.nativeSessionId).toBe("fake-thread-1");
    expect(result.usage).toEqual({
      cacheReadTokens: 1,
      inputTokens: 4,
      outputTokens: 8,
      totalTokens: 12
    });
  });

  it("maps streamed SDK thread events into portable events", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-streamed-"));
    const { loadSdk } = createFakeCodexLoader({
      streamed: true
    });
    const adapter = new CodexAdapter({ loadSdk });
    const session = await adapter.startSession({
      provider: "codex",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "stream a result",
      workspace: {
        cwd
      }
    });

    const events = await collect(adapter.stream(run));
    const result = await adapter.wait(run);

    expect(events.map((event) => event.type)).toContain("plan.updated");
    expect(events.map((event) => event.type)).toContain("command.started");
    expect(events.map((event) => event.type)).toContain("command.finished");
    expect(events.map((event) => event.type)).toContain("file.change.finished");
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.finished");
    expect(result.finalMessage).toBe("streamed final");
    expect(result.nativeSessionId).toBe("fake-thread-1");
  });

  it("resumes an existing native Codex thread id", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-resume-"));
    const { loadSdk, state } = createFakeCodexLoader();
    const adapter = new CodexAdapter({ loadSdk });

    const session = await adapter.resumeSession({
      nativeSessionId: "existing-thread",
      provider: "codex",
      sessionId: "portable-session",
      workspace: {
        cwd
      }
    });

    expect(session.sessionId).toBe("portable-session");
    expect(session.nativeSessionId).toBe("existing-thread");
    expect(state.clients[0]?.resumedThreadOptions?.workingDirectory).toBe(cwd);
    await expect(
      adapter.resumeSession({
        provider: "codex",
        workspace: {
          cwd
        }
      })
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  it("lets core capture the git diff created by a Codex SDK run", async () => {
    const cwd = await createGitWorkspace();
    const { loadSdk } = createFakeCodexLoader({
      writeFile: true
    });
    const harness = createHarness(
      {
        defaultProvider: "codex",
        providers: {
          codex: {
            provider: "codex"
          }
        },
        storage: {
          rootDir: ".harness"
        },
        workspace: {
          cwd
        }
      },
      [new CodexAdapter({ loadSdk })]
    );

    const result = await harness.run({
      provider: "codex",
      task: "write a summary"
    });

    expect(result.patchPath).toBeDefined();
    expect(result.diff).toContain("README.md");
    expect(await readFile(result.patchPath ?? "", "utf8")).toContain(
      "Codex completed: write a summary"
    );
  });

  it("maps metaharness sandbox names to Codex SDK sandbox names", () => {
    expect(mapCodexSandboxMode("read-only")).toBe("read-only");
    expect(mapCodexSandboxMode("workspace-write")).toBe("workspace-write");
    expect(mapCodexSandboxMode("full-access")).toBe("danger-full-access");
    expect(mapCodexSandboxMode("danger-full-access")).toBe("danger-full-access");
  });

  it("rejects unsupported Codex sandbox names before loading the SDK", async () => {
    expect(() => mapCodexSandboxMode("unsafe")).toThrow(ProviderConfigError);

    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-bad-sandbox-"));
    let loadCalls = 0;
    const adapter = new CodexAdapter({
      loadSdk: async () => {
        loadCalls += 1;
        throw new Error("SDK should not load for invalid sandbox config.");
      }
    });

    await expect(
      adapter.startSession({
        native: {
          sandbox: "unsafe"
        },
        provider: "codex",
        workspace: {
          cwd
        }
      })
    ).rejects.toMatchObject({
      code: "CODEX_SANDBOX_MODE_UNSUPPORTED",
      details: {
        option: "sandboxMode",
        provider: "codex"
      },
      name: "ProviderConfigError"
    });
    expect(loadCalls).toBe(0);
  });

  it("runs explicit app-server mode and maps rich protocol events", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-appserver-"));
    const { appServerClientFactory, state } = createFakeAppServerFactory();
    const adapter = new CodexAdapter({
      appServerClientFactory,
      loadSdk: async () => {
        throw new Error("SDK mode should not load for app-server runs.");
      }
    });

    const session = await adapter.startSession({
      auth: {
        apiKey: "app-server-key"
      },
      model: "gpt-5.1-codex",
      native: {
        codex: {
          appServer: {
            command: "codex-test",
            requestTimeoutMs: 123,
            threadParams: {
              serviceName: "metaharness-test"
            }
          },
          approvalPolicy: "on-request",
          mode: "app-server",
          sandbox: "workspace-write"
        }
      },
      provider: "codex",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      model: "gpt-5.2-codex",
      native: {
        codex: {
          appServer: {
            turnParams: {
              summary: "concise"
            }
          }
        }
      },
      task: "stream app-server result",
      workspace: {
        cwd
      }
    });

    const events = await collect(adapter.stream(run));
    const result = await adapter.wait(run);

    expect(state.clients[0]?.config).toMatchObject({
      command: "codex-test",
      env: {
        CODEX_API_KEY: "app-server-key",
        OPENAI_API_KEY: "app-server-key"
      },
      requestTimeoutMs: 123
    });
    expect(state.clients[0]?.initialized?.clientInfo.name).toBe("metaharness");
    expect(state.clients[0]?.startedThreadParams).toMatchObject({
      approvalPolicy: "on-request",
      cwd,
      experimentalRawEvents: false,
      model: "gpt-5.1-codex",
      persistExtendedHistory: false,
      sandbox: "workspace-write",
      serviceName: "metaharness-test"
    });
    expect(state.clients[0]?.startedTurnParams).toMatchObject({
      cwd,
      input: [
        {
          text: "stream app-server result",
          type: "text"
        }
      ],
      model: "gpt-5.2-codex",
      summary: "concise",
      threadId: "app-thread-1"
    });
    expect(events.map((event) => event.type)).toContain("provider.raw");
    expect(events.map((event) => event.type)).toContain("plan.updated");
    expect(events.map((event) => event.type)).toContain("command.started");
    expect(events.map((event) => event.type)).toContain("command.output.delta");
    expect(events.map((event) => event.type)).toContain("command.finished");
    expect(events.map((event) => event.type)).toContain("file.change.updated");
    expect(events.map((event) => event.type)).toContain("file.change.finished");
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.delta");
    expect(events.map((event) => event.type)).toContain("tool.finished");
    expect(events.map((event) => event.type)).toContain("approval.requested");
    expect(events.map((event) => event.type)).toContain("approval.resolved");
    expect(events.map((event) => event.type)).toContain("usage.updated");
    expect(events.map((event) => event.type)).toContain("diff.updated");
    expect(events.map((event) => event.type)).toContain("assistant.message.delta");
    expect(events.map((event) => event.type)).toContain("assistant.message.completed");
    expect(events.map((event) => event.type)).toContain("run.completed");
    expect(state.clients[0]?.responses).toEqual([
      {
        id: "approval-1",
        result: {
          decision: "decline"
        }
      }
    ]);
    expect(result).toMatchObject({
      diff: expect.stringContaining("README.md"),
      finalMessage: "app-server final",
      nativeRunId: "app-turn-1",
      nativeSessionId: "app-thread-1",
      status: "success",
      usage: {
        cacheReadTokens: 2,
        inputTokens: 10,
        outputTokens: 6,
        totalTokens: 16
      }
    });
  });

  it("uses a custom Codex app-server approval resolver", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-appserver-approval-"));
    const { appServerClientFactory, state } = createFakeAppServerFactory();
    const approvals: Array<{
      command: string | undefined;
      decision: string;
      method: string;
    }> = [];
    const adapter = new CodexAdapter({
      appServerApprovalResolver: ({ approval, request }) => {
        approvals.push({
          command: approval.preview?.command,
          decision: "accept",
          method: request.method
        });
        return {
          decision: "accept",
          result: {
            decision: "accept"
          }
        };
      },
      appServerClientFactory
    });

    const session = await adapter.startSession({
      native: {
        codex: {
          mode: "app-server"
        }
      },
      provider: "codex",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "approve app-server command",
      workspace: {
        cwd
      }
    });

    const events = await collect(adapter.stream(run));

    expect(approvals).toEqual([
      {
        command: "npm install",
        decision: "accept",
        method: "item/commandExecution/requestApproval"
      }
    ]);
    expect(state.clients[0]?.responses).toEqual([
      {
        id: "approval-1",
        result: {
          decision: "accept"
        }
      }
    ]);
    expect(
      events
        .filter((event) => event.type === "approval.resolved")
        .map((event) => event.decision)
    ).toEqual(["accept"]);
  });

  it("resumes and interrupts Codex app-server turns", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-appserver-resume-"));
    const { appServerClientFactory, state } = createFakeAppServerFactory({
      messages: []
    });
    const adapter = new CodexAdapter({
      appServerClientFactory
    });
    const session = await adapter.resumeSession({
      native: {
        codex: {
          mode: "app-server"
        }
      },
      nativeSessionId: "existing-app-thread",
      provider: "codex",
      sessionId: "portable-session",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "start then cancel",
      workspace: {
        cwd
      }
    });
    await adapter.cancel(run);

    expect(session.sessionId).toBe("portable-session");
    expect(session.nativeSessionId).toBe("existing-app-thread");
    expect(state.clients[0]?.resumedThreadParams?.threadId).toBe("existing-app-thread");
    expect(state.clients[0]?.interrupts).toEqual([
      {
        threadId: "existing-app-thread",
        turnId: "app-turn-1"
      }
    ]);
  });

  it("lets core capture git diff created during a Codex app-server run", async () => {
    const cwd = await createGitWorkspace();
    const { appServerClientFactory } = createFakeAppServerFactory({
      writeFile: true
    });
    const harness = createHarness(
      {
        defaultProvider: "codex",
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
        storage: {
          rootDir: ".harness"
        },
        workspace: {
          cwd
        }
      },
      [
        new CodexAdapter({
          appServerClientFactory
        })
      ]
    );

    const result = await harness.run({
      provider: "codex",
      task: "write an app-server summary"
    });

    expect(result.patchPath).toBeDefined();
    expect(result.diff).toContain("README.md");
    expect(await readFile(result.patchPath ?? "", "utf8")).toContain(
      "Codex app-server completed: write an app-server summary"
    );
  });
});

const liveIt =
  process.env.metaharness_TEST_CODEX === "1" && process.env.OPENAI_API_KEY ? it : it.skip;

liveIt(
  "runs against the real Codex SDK when explicitly enabled",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-live-"));
    await writeFile(join(cwd, "README.md"), "# live codex test\n", "utf8");
    const adapter = new CodexAdapter();
    const session = await adapter.startSession({
      native: {
        sandbox: "read-only",
        threadOptions: {
          webSearchEnabled: false,
          webSearchMode: "disabled"
        }
      },
      provider: "codex",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "Reply with exactly: metaharness live codex ok",
      workspace: {
        cwd
      }
    });
    for await (const event of adapter.stream(run)) {
      void event;
      // Drain the stream before waiting for the final result.
    }
    const result = await adapter.wait(run);
    expect(result.status).toBe("success");
    expect(result.finalMessage).toContain("metaharness");
  },
  120_000
);

const liveAppServerIt =
  process.env.metaharness_TEST_CODEX_APPSERVER === "1" &&
  (process.env.OPENAI_API_KEY || process.env.CODEX_API_KEY)
    ? it
    : it.skip;

liveAppServerIt(
  "runs against the real Codex app-server when explicitly enabled",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-appserver-live-"));
    await writeFile(join(cwd, "README.md"), "# live codex app-server test\n", "utf8");
    const adapter = new CodexAdapter();
    const session = await adapter.startSession({
      model: "gpt-5.1-codex",
      native: {
        codex: {
          approvalPolicy: "never",
          mode: "app-server",
          sandbox: "read-only"
        }
      },
      provider: "codex",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "Reply with exactly: metaharness live codex app-server ok",
      workspace: {
        cwd
      }
    });
    for await (const event of adapter.stream(run)) {
      void event;
    }
    const result = await adapter.wait(run);
    expect(result.status).toBe("success");
    expect(result.finalMessage).toContain("metaharness");
  },
  120_000
);

interface FakeCodexLoaderOptions {
  streamed?: boolean;
  writeFile?: boolean;
}

interface FakeCodexState {
  clients: FakeCodexClient[];
}

function createFakeCodexLoader(options: FakeCodexLoaderOptions = {}): {
  loadSdk: CodexSdkLoader;
  state: FakeCodexState;
} {
  const state: FakeCodexState = {
    clients: []
  };
  class FakeCodex implements CodexClientLike {
    readonly client: FakeCodexClient;

    constructor(codexOptions?: CodexOptionsLike) {
      this.client = new FakeCodexClient(codexOptions, options);
      state.clients.push(this.client);
    }

    resumeThread(id: string, threadOptions?: CodexThreadOptionsLike): CodexThreadLike {
      return this.client.resumeThread(id, threadOptions);
    }

    startThread(threadOptions?: CodexThreadOptionsLike): CodexThreadLike {
      return this.client.startThread(threadOptions);
    }
  }
  return {
    loadSdk: async () => ({
      Codex: FakeCodex
    }),
    state
  };
}

class FakeCodexClient implements CodexClientLike {
  resumedThreadOptions: CodexThreadOptionsLike | undefined;
  startedThreadOptions: CodexThreadOptionsLike | undefined;

  constructor(
    readonly options: CodexOptionsLike | undefined,
    private readonly loaderOptions: FakeCodexLoaderOptions
  ) {}

  resumeThread(id: string, threadOptions?: CodexThreadOptionsLike): CodexThreadLike {
    this.resumedThreadOptions = threadOptions;
    return new FakeThread(id, threadOptions, this.loaderOptions) as CodexThreadLike;
  }

  startThread(threadOptions?: CodexThreadOptionsLike): CodexThreadLike {
    this.startedThreadOptions = threadOptions;
    return new FakeThread(
      "fake-thread-1",
      threadOptions,
      this.loaderOptions
    ) as CodexThreadLike;
  }
}

class FakeThread {
  id: string | null = null;

  constructor(
    private readonly nextId: string,
    private readonly threadOptions: CodexThreadOptionsLike | undefined,
    private readonly loaderOptions: FakeCodexLoaderOptions
  ) {
    if (loaderOptions.streamed) {
      Object.assign(this, {
        runStreamed: async () => ({
          events: this.streamEvents()
        })
      });
    }
  }

  async run(
    input: CodexInputLike,
    _options?: CodexTurnOptionsLike
  ): Promise<CodexTurnLike> {
    this.id = this.nextId;
    const task = inputToText(input);
    if (this.loaderOptions.writeFile && this.threadOptions?.workingDirectory) {
      await writeFile(
        resolve(this.threadOptions.workingDirectory, "README.md"),
        `# codex adapter test\n\nCodex completed: ${task}\n`,
        "utf8"
      );
    }
    return {
      finalResponse: `Codex completed: ${task}`,
      items: [
        {
          id: "agent-message-1",
          text: `Codex completed: ${task}`,
          type: "agent_message"
        }
      ],
      usage: {
        cached_input_tokens: 1,
        input_tokens: 4,
        output_tokens: 7,
        reasoning_output_tokens: 1
      }
    };
  }

  private async *streamEvents(): AsyncIterable<CodexThreadEventLike> {
    this.id = this.nextId;
    yield {
      thread_id: this.nextId,
      type: "thread.started"
    };
    yield {
      type: "turn.started"
    };
    yield {
      item: {
        id: "todo-1",
        items: [
          {
            completed: false,
            text: "Inspect workspace"
          },
          {
            completed: true,
            text: "Return result"
          }
        ],
        type: "todo_list"
      },
      type: "item.updated"
    };
    yield {
      item: {
        aggregated_output: "ok\n",
        command: "pnpm test",
        id: "command-1",
        status: "in_progress",
        type: "command_execution"
      },
      type: "item.started"
    };
    yield {
      item: {
        aggregated_output: "ok\n",
        command: "pnpm test",
        exit_code: 0,
        id: "command-1",
        status: "completed",
        type: "command_execution"
      },
      type: "item.completed"
    };
    yield {
      item: {
        changes: [
          {
            kind: "update",
            path: "README.md"
          }
        ],
        id: "file-1",
        status: "completed",
        type: "file_change"
      },
      type: "item.completed"
    };
    yield {
      item: {
        arguments: {
          query: "status"
        },
        id: "tool-1",
        result: {
          ok: true
        },
        server: "local",
        status: "completed",
        tool: "status",
        type: "mcp_tool_call"
      },
      type: "item.started"
    };
    yield {
      item: {
        arguments: {
          query: "status"
        },
        id: "tool-1",
        result: {
          ok: true
        },
        server: "local",
        status: "completed",
        tool: "status",
        type: "mcp_tool_call"
      },
      type: "item.completed"
    };
    yield {
      item: {
        id: "agent-message-1",
        text: "streamed final",
        type: "agent_message"
      },
      type: "item.completed"
    };
    yield {
      type: "turn.completed",
      usage: {
        cached_input_tokens: 0,
        input_tokens: 3,
        output_tokens: 4,
        reasoning_output_tokens: 0
      }
    };
  }
}

interface FakeAppServerOptions {
  messages?: CodexAppServerInboundMessage[];
  writeFile?: boolean;
}

interface FakeAppServerState {
  clients: FakeAppServerClient[];
}

function createFakeAppServerFactory(options: FakeAppServerOptions = {}): {
  appServerClientFactory: CodexAppServerClientFactory;
  state: FakeAppServerState;
} {
  const state: FakeAppServerState = {
    clients: []
  };
  return {
    appServerClientFactory: async (config) => {
      const client = new FakeAppServerClient(config, options);
      state.clients.push(client);
      return client;
    },
    state
  };
}

class FakeAppServerClient implements CodexAppServerClientLike {
  initialized: CodexAppServerInitializeParams | undefined;
  interrupts: Array<{
    threadId: string;
    turnId: string;
  }> = [];
  responses: Array<{
    id: CodexAppServerJsonRpcId;
    result: unknown;
  }> = [];
  responseErrors: Array<{
    error: unknown;
    id: CodexAppServerJsonRpcId;
  }> = [];
  resumedThreadParams: CodexAppServerThreadResumeParamsLike | undefined;
  startedThreadParams: CodexAppServerThreadStartParamsLike | undefined;
  startedTurnParams: CodexAppServerTurnStartParamsLike | undefined;

  constructor(
    readonly config: CodexAppServerClientConfig,
    private readonly options: FakeAppServerOptions
  ) {}

  async initialize(params: CodexAppServerInitializeParams): Promise<unknown> {
    this.initialized = params;
    return {
      userAgent: "fake-codex-app-server"
    };
  }

  async startThread(
    params: CodexAppServerThreadStartParamsLike
  ): Promise<CodexAppServerThreadResponseLike> {
    this.startedThreadParams = params;
    const thread = {
      id: "app-thread-1",
      turns: []
    };
    if (params.cwd) {
      Object.assign(thread, {
        cwd: params.cwd
      });
    }
    return {
      thread
    };
  }

  async resumeThread(
    params: CodexAppServerThreadResumeParamsLike
  ): Promise<CodexAppServerThreadResponseLike> {
    this.resumedThreadParams = params;
    const thread = {
      id: params.threadId,
      turns: []
    };
    if (params.cwd) {
      Object.assign(thread, {
        cwd: params.cwd
      });
    }
    return {
      thread
    };
  }

  async startTurn(
    params: CodexAppServerTurnStartParamsLike
  ): Promise<CodexAppServerTurnResponseLike> {
    this.startedTurnParams = params;
    if (this.options.writeFile && params.cwd) {
      await writeFile(
        resolve(params.cwd, "README.md"),
        `# codex app-server adapter test\n\nCodex app-server completed: ${inputTextFromAppServer(params)}\n`,
        "utf8"
      );
    }
    return {
      turn: {
        id: "app-turn-1",
        items: [],
        status: "inProgress"
      }
    };
  }

  async interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    this.interrupts.push({
      threadId,
      turnId
    });
    return {};
  }

  async respond(id: CodexAppServerJsonRpcId, result: unknown): Promise<void> {
    this.responses.push({
      id,
      result
    });
  }

  async respondError(id: CodexAppServerJsonRpcId, error: unknown): Promise<void> {
    this.responseErrors.push({
      error,
      id
    });
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }

  async *events(): AsyncIterable<CodexAppServerInboundMessage> {
    for (const message of this.options.messages ?? defaultAppServerMessages()) {
      yield message;
    }
  }
}

function defaultAppServerMessages(): CodexAppServerInboundMessage[] {
  return [
    {
      method: "thread/started",
      params: {
        thread: {
          id: "app-thread-1"
        }
      }
    },
    {
      method: "turn/started",
      params: {
        threadId: "app-thread-1",
        turn: {
          id: "app-turn-1",
          status: "inProgress"
        }
      }
    },
    {
      method: "turn/plan/updated",
      params: {
        explanation: "Work through the requested task.",
        plan: [
          {
            status: "inProgress",
            step: "Inspect workspace"
          },
          {
            status: "pending",
            step: "Return result"
          }
        ],
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/started",
      params: {
        item: {
          command: "pnpm test",
          cwd: "/workspace",
          id: "cmd-1",
          status: "inProgress",
          type: "commandExecution"
        },
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/commandExecution/outputDelta",
      params: {
        delta: "ok\n",
        itemId: "cmd-1",
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/completed",
      params: {
        item: {
          aggregatedOutput: "ok\n",
          command: "pnpm test",
          cwd: "/workspace",
          durationMs: 12,
          exitCode: 0,
          id: "cmd-1",
          status: "completed",
          type: "commandExecution"
        },
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/fileChange/patchUpdated",
      params: {
        changes: [
          {
            diff: "@@ -1 +1 @@\n-before\n+after\n",
            kind: "update",
            path: "README.md"
          }
        ],
        itemId: "file-1",
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/completed",
      params: {
        item: {
          changes: [
            {
              diff: "@@ -1 +1 @@\n-before\n+after\n",
              kind: "update",
              path: "README.md"
            }
          ],
          id: "file-1",
          status: "completed",
          type: "fileChange"
        },
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/started",
      params: {
        item: {
          action: {
            queries: ["metaharness"],
            type: "search"
          },
          id: "web-1",
          query: "metaharness",
          type: "webSearch"
        },
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/completed",
      params: {
        item: {
          action: {
            queries: ["metaharness"],
            type: "search"
          },
          id: "web-1",
          query: "metaharness",
          type: "webSearch"
        },
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/started",
      params: {
        item: {
          arguments: {
            query: "status"
          },
          id: "tool-1",
          result: null,
          server: "local",
          status: "inProgress",
          tool: "status",
          type: "mcpToolCall"
        },
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/mcpToolCall/progress",
      params: {
        itemId: "tool-1",
        message: "running status",
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/completed",
      params: {
        item: {
          arguments: {
            query: "status"
          },
          id: "tool-1",
          result: {
            ok: true
          },
          server: "local",
          status: "completed",
          tool: "status",
          type: "mcpToolCall"
        },
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: {
        availableDecisions: ["accept", "decline", "cancel"],
        command: "npm install",
        cwd: "/workspace",
        itemId: "cmd-2",
        reason: "network access",
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: "app-thread-1",
        tokenUsage: {
          last: {
            cachedInputTokens: 1,
            inputTokens: 4,
            outputTokens: 2,
            reasoningOutputTokens: 1,
            totalTokens: 7
          },
          total: {
            cachedInputTokens: 2,
            inputTokens: 10,
            outputTokens: 5,
            reasoningOutputTokens: 1,
            totalTokens: 16
          }
        },
        turnId: "app-turn-1"
      }
    },
    {
      method: "turn/diff/updated",
      params: {
        diff: "diff --git a/README.md b/README.md\n",
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "item/agentMessage/delta",
      params: {
        delta: "app-server final",
        itemId: "message-1",
        threadId: "app-thread-1",
        turnId: "app-turn-1"
      }
    },
    {
      method: "turn/completed",
      params: {
        threadId: "app-thread-1",
        turn: {
          id: "app-turn-1",
          items: [],
          status: "completed"
        }
      }
    }
  ];
}

async function collect(
  events: AsyncIterable<PortableRunEvent>
): Promise<PortableRunEvent[]> {
  const output: PortableRunEvent[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

function inputTextFromAppServer(params: CodexAppServerTurnStartParamsLike): string {
  return params.input
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

function inputToText(input: CodexInputLike): string {
  if (typeof input === "string") {
    return input;
  }
  return input
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n");
}

async function createGitWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "metaharness-codex-git-"));
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "README.md"), "# codex adapter test\n", "utf8");
  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.email", "codex-test@example.com"]);
  await git(cwd, ["config", "user.name", "Codex Test"]);
  await git(cwd, ["add", "README.md"]);
  await git(cwd, ["commit", "-m", "initial"]);
  return cwd;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd
  });
}
