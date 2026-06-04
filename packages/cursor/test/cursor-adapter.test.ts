import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createHarness, UnsupportedCapabilityError } from "@metaharness/core";
import { CursorAdapter } from "../src/index.js";
import type {
  CursorAgentLike,
  CursorAgentOptionsLike,
  CursorArtifactLike,
  CursorRunLike,
  CursorRunResultLike,
  CursorSdkLoader,
  CursorSdkMessageLike,
  CursorSendOptionsLike
} from "../src/index.js";
import type { PortableRunEvent } from "@metaharness/core";

const execFileAsync = promisify(execFile);

describe("CursorAdapter", () => {
  it("reports an honest Cursor SDK capability matrix", async () => {
    const { loadSdk } = createFakeCursorLoader();
    const capabilities = await new CursorAdapter({ loadSdk }).capabilities();

    expect(capabilities.provider).toBe("cursor");
    expect(capabilities.lifecycle.start.supported).toBe(true);
    expect(capabilities.lifecycle.resume.stability).toBe("beta");
    expect(capabilities.lifecycle.cancel.supported).toBe(false);
    expect(capabilities.lifecycle.fork.supported).toBe(false);
    expect(capabilities.workspace.gitDiff.notes).toContain("core workspace manager");

    const cloudCapabilities = await new CursorAdapter({ loadSdk }).capabilities({
      runtime: "cloud"
    });
    expect(cloudCapabilities.lifecycle.cancel.supported).toBe(true);
    expect(cloudCapabilities.lifecycle.cancel.stability).toBe("beta");
  });

  it("starts a local agent, streams portable events, and maps the final result", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cursor-local-"));
    const { loadSdk, state } = createFakeCursorLoader();
    const adapter = new CursorAdapter({ loadSdk });

    const session = await adapter.startSession({
      auth: {
        apiKey: "cursor-test-key"
      },
      model: "cursor-fast",
      native: {
        cursor: {
          local: {
            settingSources: ["user"]
          }
        }
      },
      provider: "cursor",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      mode: "plan",
      model: "composer-2",
      native: {
        cursor: {
          sendOptions: {
            idempotencyKey: "send-1"
          }
        }
      },
      task: "summarize this repo",
      workspace: {
        cwd
      }
    });

    const events = await collect(adapter.stream(run));
    const result = await adapter.wait(run);

    expect(state.agents[0]?.options).toMatchObject({
      apiKey: "cursor-test-key",
      local: {
        cwd,
        settingSources: ["user"]
      },
      model: {
        id: "cursor-fast"
      }
    });
    expect(state.agents[0]?.sent[0]).toMatchObject({
      message: "summarize this repo",
      options: {
        idempotencyKey: "send-1",
        mode: "plan",
        model: {
          id: "composer-2"
        }
      }
    });
    expect(events.map((event) => event.type)).toContain("provider.raw");
    expect(events.map((event) => event.type)).toContain("assistant.message.delta");
    expect(events.map((event) => event.type)).toContain("assistant.message.completed");
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.finished");
    expect(events.map((event) => event.type)).toContain("plan.updated");
    expect(events.map((event) => event.type)).toContain("approval.requested");
    expect(events.map((event) => event.type)).toContain("run.status");
    expect(result.status).toBe("success");
    expect(result.finalMessage).toBe("Cursor completed: summarize this repo");
    expect(result.nativeRunId).toBe("cursor-run-1");
    expect(result.nativeSessionId).toBe("cursor-agent-1");
    expect(result.providerRunUrl).toBe("https://cursor.example/pr/1");
    expect(result.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "branch",
          name: "cursor/run-1"
        }),
        expect.objectContaining({
          kind: "pull_request",
          url: "https://cursor.example/pr/1"
        }),
        expect.objectContaining({
          kind: "url",
          url: "https://cursor.example/artifact/1"
        })
      ])
    );
  });

  it("requires explicit cloud runtime before using Cursor cloud options", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cursor-cloud-"));
    const { loadSdk, state } = createFakeCursorLoader();
    const adapter = new CursorAdapter({ loadSdk });

    const session = await adapter.startSession({
      auth: {
        apiKey: "cursor-cloud-key"
      },
      native: {
        cursor: {
          agentOptions: {
            name: "cloud-agent"
          },
          cloud: {
            autoCreatePR: true,
            repos: [
              {
                startingRef: "main",
                url: "https://github.com/example/repo"
              }
            ]
          }
        }
      },
      provider: "cursor",
      runtime: "cloud",
      workspace: {
        cwd
      }
    });

    expect(session.native.runtime).toBe("cloud");
    expect(state.agents[0]?.options).toMatchObject({
      apiKey: "cursor-cloud-key",
      cloud: {
        autoCreatePR: true,
        repos: [
          {
            startingRef: "main",
            url: "https://github.com/example/repo"
          }
        ]
      },
      name: "cloud-agent"
    });
    expect(state.agents[0]?.options.local).toBeUndefined();
  });

  it("resumes an existing Cursor agent before sending a follow-up prompt", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cursor-resume-"));
    const { loadSdk, state } = createFakeCursorLoader();
    const adapter = new CursorAdapter({ loadSdk });

    const session = await adapter.resumeSession({
      auth: {
        apiKey: "cursor-resume-key"
      },
      model: "composer-2",
      native: {
        cursor: {
          local: {
            settingSources: ["project"]
          }
        }
      },
      nativeSessionId: "cursor-agent-existing",
      provider: "cursor",
      sessionId: "portable-cursor-session",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "Also update the changelog",
      workspace: {
        cwd
      }
    });
    const result = await adapter.wait(run);

    expect(session.sessionId).toBe("portable-cursor-session");
    expect(session.nativeSessionId).toBe("cursor-agent-existing");
    expect(run.nativeSessionId).toBe("cursor-agent-existing");
    expect(result.nativeSessionId).toBe("cursor-agent-existing");
    expect(state.resumes).toEqual([
      expect.objectContaining({
        agentId: "cursor-agent-existing",
        options: expect.objectContaining({
          apiKey: "cursor-resume-key",
          local: {
            cwd,
            settingSources: ["project"]
          },
          model: {
            id: "composer-2"
          }
        })
      })
    ]);
    expect(state.agents.at(-1)?.sent[0]).toMatchObject({
      message: "Also update the changelog"
    });
  });

  it("throws a typed unsupported capability error when cancel is unavailable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cursor-cancel-"));
    const { loadSdk } = createFakeCursorLoader({
      unsupportedCancel: true
    });
    const adapter = new CursorAdapter({ loadSdk });
    const session = await adapter.startSession({
      provider: "cursor",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "keep running",
      workspace: {
        cwd
      }
    });

    await expect(adapter.cancel(run)).rejects.toBeInstanceOf(UnsupportedCapabilityError);
  });

  it("lets core capture the git diff created by a Cursor SDK run", async () => {
    const cwd = await createGitWorkspace();
    const { loadSdk } = createFakeCursorLoader({
      writeFile: true
    });
    const harness = createHarness(
      {
        defaultProvider: "cursor",
        providers: {
          cursor: {
            provider: "cursor"
          }
        },
        storage: {
          rootDir: ".harness"
        },
        workspace: {
          cwd
        }
      },
      [new CursorAdapter({ loadSdk })]
    );

    const result = await harness.run({
      provider: "cursor",
      task: "write a summary"
    });

    expect(result.patchPath).toBeDefined();
    expect(result.diff).toContain("README.md");
    expect(await readFile(result.patchPath ?? "", "utf8")).toContain(
      "Cursor completed: write a summary"
    );
  });
});

const liveIt =
  process.env.metaharness_TEST_CURSOR === "1" && process.env.CURSOR_API_KEY
    ? it
    : it.skip;

liveIt(
  "runs against the real Cursor SDK when explicitly enabled",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cursor-live-"));
    await writeFile(join(cwd, "README.md"), "# live cursor test\n", "utf8");
    const adapter = new CursorAdapter();
    const session = await adapter.startSession({
      model: "composer-2",
      provider: "cursor",
      runtime: "local",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "Reply with exactly: metaharness live cursor ok",
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

interface FakeCursorLoaderOptions {
  unsupportedCancel?: boolean;
  writeFile?: boolean;
}

interface FakeCursorState {
  agents: FakeCursorAgent[];
  resumes: Array<{
    agentId: string;
    options?: Partial<CursorAgentOptionsLike>;
  }>;
}

function createFakeCursorLoader(options: FakeCursorLoaderOptions = {}): {
  loadSdk: CursorSdkLoader;
  state: FakeCursorState;
} {
  const state: FakeCursorState = {
    agents: [],
    resumes: []
  };

  class FakeAgentFactory {
    static create(agentOptions: CursorAgentOptionsLike): CursorAgentLike {
      const agent = new FakeCursorAgent(agentOptions, options);
      state.agents.push(agent);
      return agent;
    }

    static resume(
      agentId: string,
      agentOptions?: Partial<CursorAgentOptionsLike>
    ): CursorAgentLike {
      const agent = new FakeCursorAgent(agentOptions ?? {}, options, agentId);
      state.resumes.push({
        agentId,
        ...(agentOptions ? { options: agentOptions } : {})
      });
      state.agents.push(agent);
      return agent;
    }
  }

  return {
    loadSdk: async () => ({
      Agent: FakeAgentFactory
    }),
    state
  };
}

class FakeCursorAgent implements CursorAgentLike {
  readonly agentId: string;
  readonly sent: Array<{
    message: string | { text: string };
    options?: CursorSendOptionsLike;
  }> = [];

  constructor(
    readonly options: CursorAgentOptionsLike,
    private readonly loaderOptions: FakeCursorLoaderOptions,
    agentId = "cursor-agent-1"
  ) {
    this.agentId = agentId;
  }

  async send(
    message: string | { text: string },
    options?: CursorSendOptionsLike
  ): Promise<CursorRunLike> {
    this.sent.push({
      message,
      ...(options ? { options } : {})
    });
    return new FakeCursorRun(
      this.agentId,
      inputToText(message),
      this.options.local?.cwd,
      this.loaderOptions
    );
  }

  async listArtifacts(): Promise<CursorArtifactLike[]> {
    return [
      {
        name: "cursor-artifact",
        url: "https://cursor.example/artifact/1"
      }
    ];
  }
}

class FakeCursorRun implements CursorRunLike {
  readonly agentId: string;
  readonly id = "cursor-run-1";
  durationMs?: number;
  git?: NonNullable<CursorRunResultLike["git"]>;
  model = {
    id: "composer-2"
  };
  result?: string;
  status = "running";

  constructor(
    agentId: string,
    private readonly task: string,
    private readonly cwd: string | string[] | undefined,
    private readonly loaderOptions: FakeCursorLoaderOptions
  ) {
    this.agentId = agentId;
  }

  supports(operation: "stream" | "wait" | "cancel" | "conversation"): boolean {
    return operation !== "cancel" || !this.loaderOptions.unsupportedCancel;
  }

  unsupportedReason(operation: "stream" | "wait" | "cancel" | "conversation"): string {
    return `Cursor operation ${operation} is disabled in this fake run.`;
  }

  async cancel(): Promise<void> {
    this.status = "cancelled";
  }

  async *stream(): AsyncIterable<CursorSdkMessageLike> {
    yield {
      agent_id: this.agentId,
      model: this.model,
      run_id: this.id,
      subtype: "init",
      tools: ["shell"],
      type: "system"
    };
    yield {
      agent_id: this.agentId,
      message: "Cursor run started.",
      run_id: this.id,
      status: "RUNNING",
      type: "status"
    };
    yield {
      agent_id: this.agentId,
      run_id: this.id,
      text: "Thinking through the task.",
      type: "thinking"
    };
    yield {
      agent_id: this.agentId,
      message: {
        content: [
          {
            text: `Cursor completed: ${this.task}`,
            type: "text"
          },
          {
            id: "tool-use-1",
            input: {
              command: "git status"
            },
            name: "shell",
            type: "tool_use"
          }
        ],
        role: "assistant"
      },
      run_id: this.id,
      type: "assistant"
    };
    yield {
      agent_id: this.agentId,
      args: {
        command: "git status"
      },
      call_id: "tool-call-1",
      name: "shell",
      run_id: this.id,
      status: "running",
      type: "tool_call"
    };
    yield {
      agent_id: this.agentId,
      call_id: "tool-call-1",
      name: "shell",
      result: {
        stdout: "clean"
      },
      run_id: this.id,
      status: "completed",
      type: "tool_call"
    };
    yield {
      agent_id: this.agentId,
      run_id: this.id,
      status: "running",
      text: "Inspect workspace",
      type: "task"
    };
    yield {
      agent_id: this.agentId,
      request_id: "request-1",
      run_id: this.id,
      type: "request"
    };
    yield {
      agent_id: this.agentId,
      message: "Cursor run finished.",
      run_id: this.id,
      status: "FINISHED",
      type: "status"
    };
  }

  async wait(): Promise<CursorRunResultLike> {
    if (this.loaderOptions.writeFile && typeof this.cwd === "string") {
      await writeFile(
        resolve(this.cwd, "README.md"),
        `# cursor adapter test\n\nCursor completed: ${this.task}\n`,
        "utf8"
      );
    }
    this.status = "finished";
    this.durationMs = 25;
    this.git = {
      branches: [
        {
          branch: "cursor/run-1",
          prUrl: "https://cursor.example/pr/1",
          repoUrl: "https://github.com/example/repo"
        }
      ]
    };
    this.result = `Cursor completed: ${this.task}`;
    return {
      durationMs: this.durationMs,
      git: this.git,
      id: this.id,
      model: this.model,
      result: this.result,
      status: "finished"
    };
  }
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

function inputToText(input: string | { text: string }): string {
  return typeof input === "string" ? input : input.text;
}

async function createGitWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "metaharness-cursor-git-"));
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "README.md"), "# cursor adapter test\n", "utf8");
  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.email", "cursor-test@example.com"]);
  await git(cwd, ["config", "user.name", "Cursor Test"]);
  await git(cwd, ["add", "README.md"]);
  await git(cwd, ["commit", "-m", "initial"]);
  return cwd;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd
  });
}
