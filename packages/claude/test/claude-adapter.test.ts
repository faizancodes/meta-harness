import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { ProviderConfigError, createHarness } from "@metaharness/core";
import { ClaudeAdapter } from "../src/index.js";
import type {
  ClaudeOptionsLike,
  ClaudeSdkLoader,
  ClaudeSdkMessageLike
} from "../src/index.js";
import type { PortableRunEvent } from "@metaharness/core";

const execFileAsync = promisify(execFile);

describe("ClaudeAdapter", () => {
  it("reports an honest Claude Agent SDK capability matrix", async () => {
    const { loadSdk } = createFakeClaudeLoader();
    const capabilities = await new ClaudeAdapter({ loadSdk }).capabilities();

    expect(capabilities.provider).toBe("claude");
    expect(capabilities.lifecycle.start.supported).toBe(true);
    expect(capabilities.lifecycle.resume.supported).toBe(true);
    expect(capabilities.tools.hooks.supported).toBe(true);
    expect(capabilities.observability.cost.supported).toBe(true);
    expect(capabilities.knownLimitations).toContain(
      "Native Claude session state is provider-local and not portable."
    );
  });

  it("maps Claude query messages into portable events and final result", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-claude-events-"));
    const { loadSdk, state } = createFakeClaudeLoader();
    const adapter = new ClaudeAdapter({ loadSdk });
    const session = await adapter.startSession({
      auth: {
        apiKey: "test-anthropic-key"
      },
      model: "claude-sonnet-4-6",
      native: {
        claude: {
          maxTurns: 8
        }
      },
      provider: "claude",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      limits: {
        maxCostUsd: 0.25,
        maxTurns: 4
      },
      task: "summarize this repo",
      workspace: {
        cwd
      }
    });

    const events = await collect(adapter.stream(run));
    const result = await adapter.wait(run);

    expect(state.calls[0]?.prompt).toBe("summarize this repo");
    expect(state.calls[0]?.options).toMatchObject({
      cwd,
      includeHookEvents: true,
      includePartialMessages: true,
      maxBudgetUsd: 0.25,
      maxTurns: 4,
      model: "claude-sonnet-4-6",
      settingSources: [],
      systemPrompt: {
        preset: "claude_code",
        type: "preset"
      }
    });
    expect(state.calls[0]?.options.env?.ANTHROPIC_API_KEY).toBe("test-anthropic-key");
    expect(events.map((event) => event.type)).toContain("provider.raw");
    expect(events.map((event) => event.type)).toContain("assistant.message.delta");
    expect(events.map((event) => event.type)).toContain("assistant.message.completed");
    expect(events.map((event) => event.type)).toContain("tool.started");
    expect(events.map((event) => event.type)).toContain("tool.finished");
    expect(events.map((event) => event.type)).toContain("usage.updated");
    expect(events.map((event) => event.type)).toContain("run.completed");
    expect(result.status).toBe("success");
    expect(result.finalMessage).toBe("Claude completed: summarize this repo");
    expect(result.nativeSessionId).toBe("claude-native-session");
    expect(result.usage).toEqual({
      cacheReadTokens: 1,
      cacheWriteTokens: 2,
      estimatedCostUsd: 0.0123,
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 21
    });
  });

  it("resumes by native Claude session id", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-claude-resume-"));
    const { loadSdk, state } = createFakeClaudeLoader();
    const adapter = new ClaudeAdapter({ loadSdk });
    const session = await adapter.resumeSession({
      nativeSessionId: "existing-claude-session",
      provider: "claude",
      sessionId: "portable-session",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "continue",
      workspace: {
        cwd
      }
    });
    await collect(adapter.stream(run));

    expect(state.calls[0]?.options.resume).toBe("existing-claude-session");
    expect(session.sessionId).toBe("portable-session");
    expect(session.nativeSessionId).toBe("existing-claude-session");
  });

  it("denies dangerous Bash commands through metaharness policy", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-claude-policy-"));
    const { loadSdk, state } = createFakeClaudeLoader();
    const adapter = new ClaudeAdapter({ loadSdk });
    const session = await adapter.startSession({
      provider: "claude",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      policy: {
        inline: {
          approvals: {
            requireHumanFor: []
          },
          commands: {
            allow: ["pnpm test"],
            default: "deny",
            deny: ["rm -rf *"]
          },
          filesystem: {
            deny: [],
            mode: "workspace-write",
            writableRoots: ["."]
          },
          limits: {},
          network: {
            allowHosts: [],
            mode: "deny-by-default"
          },
          providerOverrides: {},
          secrets: {
            redactEnv: [],
            redactPatterns: []
          },
          version: 1
        }
      },
      task: "try a command",
      workspace: {
        cwd
      }
    });

    const decision = await state.calls[0]?.options.canUseTool?.(
      "Bash",
      {
        command: "rm -rf ."
      },
      {
        signal: new AbortController().signal,
        toolUseID: "tool-danger"
      }
    );

    expect(decision).toEqual({
      behavior: "deny",
      message: 'Command matched deny rule "rm -rf *".',
      toolUseID: "tool-danger"
    });
    await collect(adapter.stream(run));
  });

  it("reports invalid adapter-local policy with a typed provider config error", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-claude-policy-invalid-"));
    const { loadSdk, state } = createFakeClaudeLoader();
    const adapter = new ClaudeAdapter({ loadSdk });
    const session = await adapter.startSession({
      provider: "claude",
      workspace: {
        cwd
      }
    });

    await expect(
      adapter.run(session, {
        policy: {
          inline: {
            filesystem: {
              mode: "danger"
            },
            version: 1
          }
        },
        task: "invalid policy",
        workspace: {
          cwd
        }
      })
    ).rejects.toMatchObject({
      code: "CLAUDE_POLICY_INVALID",
      details: {
        option: "policy.inline",
        provider: "claude"
      },
      name: "ProviderConfigError"
    });
    await expect(
      adapter.run(session, {
        policy: {
          inline: {
            filesystem: {
              mode: "danger"
            },
            version: 1
          }
        },
        task: "invalid policy",
        workspace: {
          cwd
        }
      })
    ).rejects.toBeInstanceOf(ProviderConfigError);
    expect(state.calls).toHaveLength(0);
  });

  it("lets core capture git diff created during a Claude query", async () => {
    const cwd = await createGitWorkspace();
    const { loadSdk } = createFakeClaudeLoader({
      writeFile: true
    });
    const harness = createHarness(
      {
        defaultProvider: "claude",
        providers: {
          claude: {
            provider: "claude"
          }
        },
        storage: {
          rootDir: ".harness"
        },
        workspace: {
          cwd
        }
      },
      [new ClaudeAdapter({ loadSdk })]
    );

    const result = await harness.run({
      provider: "claude",
      task: "write a summary"
    });

    expect(result.patchPath).toBeDefined();
    expect(result.diff).toContain("README.md");
    expect(await readFile(result.patchPath ?? "", "utf8")).toContain(
      "Claude completed: write a summary"
    );
  });
});

const liveIt =
  process.env.metaharness_TEST_CLAUDE === "1" && process.env.ANTHROPIC_API_KEY
    ? it
    : it.skip;

liveIt(
  "runs against the real Claude Agent SDK when explicitly enabled",
  async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-claude-live-"));
    await writeFile(join(cwd, "README.md"), "# live claude test\n", "utf8");
    const adapter = new ClaudeAdapter();
    const session = await adapter.startSession({
      native: {
        claude: {
          allowedTools: ["Read", "Glob", "Grep", "LS"],
          disallowedTools: ["Bash", "Edit", "Write"],
          maxTurns: 2,
          settingSources: []
        }
      },
      provider: "claude",
      workspace: {
        cwd
      }
    });
    const run = await adapter.run(session, {
      task: "Reply with exactly: metaharness live claude ok",
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

interface FakeClaudeLoaderOptions {
  writeFile?: boolean;
}

interface FakeClaudeState {
  calls: Array<{
    options: ClaudeOptionsLike;
    prompt: string | AsyncIterable<unknown>;
  }>;
}

function createFakeClaudeLoader(options: FakeClaudeLoaderOptions = {}): {
  loadSdk: ClaudeSdkLoader;
  state: FakeClaudeState;
} {
  const state: FakeClaudeState = {
    calls: []
  };
  return {
    loadSdk: async () => ({
      query: (params) => {
        state.calls.push({
          options: params.options ?? {},
          prompt: params.prompt
        });
        return fakeQuery(params.prompt, params.options ?? {}, options);
      }
    }),
    state
  };
}

function fakeQuery(
  prompt: string | AsyncIterable<unknown>,
  options: ClaudeOptionsLike,
  loaderOptions: FakeClaudeLoaderOptions
): AsyncIterable<ClaudeSdkMessageLike> & { close: () => void } {
  let closed = false;
  const iterable = {
    async *[Symbol.asyncIterator]() {
      const textPrompt = typeof prompt === "string" ? prompt : "streamed prompt";
      yield {
        cwd: options.cwd ?? process.cwd(),
        model: options.model ?? "claude-test",
        permissionMode: "default",
        session_id: "claude-native-session",
        subtype: "init",
        tools: ["Read", "Bash"],
        type: "system",
        uuid: "system-1"
      } satisfies ClaudeSdkMessageLike;
      yield {
        event: {
          delta: {
            text: "working",
            type: "text_delta"
          },
          type: "content_block_delta"
        },
        parent_tool_use_id: null,
        session_id: "claude-native-session",
        type: "stream_event",
        uuid: "stream-1"
      } satisfies ClaudeSdkMessageLike;
      yield {
        message: {
          content: [
            {
              text: "Read the repository.",
              type: "text"
            },
            {
              id: "tool-read",
              input: {
                file_path: "README.md"
              },
              name: "Read",
              type: "tool_use"
            }
          ],
          usage: {
            cache_creation_input_tokens: 1,
            cache_read_input_tokens: 1,
            input_tokens: 5,
            output_tokens: 3
          }
        },
        parent_tool_use_id: null,
        session_id: "claude-native-session",
        type: "assistant",
        uuid: "assistant-1"
      } satisfies ClaudeSdkMessageLike;
      yield {
        message: {
          content: [
            {
              content: "README contents",
              tool_use_id: "tool-read",
              type: "tool_result"
            }
          ],
          role: "user"
        },
        parent_tool_use_id: null,
        session_id: "claude-native-session",
        type: "user",
        uuid: "user-1"
      } satisfies ClaudeSdkMessageLike;
      if (loaderOptions.writeFile && options.cwd) {
        await writeFile(
          resolve(options.cwd, "README.md"),
          `# claude adapter test\n\nClaude completed: ${textPrompt}\n`,
          "utf8"
        );
      }
      if (closed) {
        return;
      }
      yield {
        duration_api_ms: 5,
        duration_ms: 10,
        is_error: false,
        modelUsage: {},
        num_turns: 1,
        permission_denials: [],
        result: `Claude completed: ${textPrompt}`,
        session_id: "claude-native-session",
        stop_reason: "end_turn",
        subtype: "success",
        total_cost_usd: 0.0123,
        type: "result",
        usage: {
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 1,
          input_tokens: 11,
          output_tokens: 7
        },
        uuid: "result-1"
      } satisfies ClaudeSdkMessageLike;
    },
    close: () => {
      closed = true;
    }
  };
  return iterable;
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

async function createGitWorkspace(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "metaharness-claude-git-"));
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, "README.md"), "# claude adapter test\n", "utf8");
  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.email", "claude-test@example.com"]);
  await git(cwd, ["config", "user.name", "Claude Test"]);
  await git(cwd, ["add", "README.md"]);
  await git(cwd, ["commit", "-m", "initial"]);
  return cwd;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd
  });
}
