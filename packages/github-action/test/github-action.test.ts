import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeAction, runAction } from "../src/index.js";
import type { ActionGitOptions, ActionGitRunner } from "../src/index.js";
import type { Harness, RunResult } from "@metaharness/core";

const coreMock = vi.hoisted(() => {
  const inputs = new Map<string, string>();
  const outputs = new Map<string, string>();
  const failed: string[] = [];
  const infos: string[] = [];
  const secrets: string[] = [];
  const warnings: string[] = [];
  return {
    failed,
    getBooleanInput: vi.fn((name: string) =>
      ["true", "True", "TRUE"].includes(inputs.get(name) ?? "")
    ),
    getInput: vi.fn((name: string, options?: { required?: boolean }) => {
      const value = inputs.get(name) ?? "";
      if (options?.required && !value) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    }),
    getMultilineInput: vi.fn((name: string) =>
      (inputs.get(name) ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    ),
    info: vi.fn((message: string) => {
      infos.push(message);
    }),
    infos,
    inputs,
    outputs,
    secrets,
    setFailed: vi.fn((message: string | Error) => {
      failed.push(message instanceof Error ? message.message : message);
    }),
    setOutput: vi.fn((name: string, value: unknown) => {
      outputs.set(name, String(value));
    }),
    setSecret: vi.fn((secret: string) => {
      secrets.push(secret);
    }),
    warning: vi.fn((message: string | Error) => {
      warnings.push(message instanceof Error ? message.message : message);
    }),
    warnings
  };
});

const githubMock = vi.hoisted(() => {
  const createPullRequest = vi.fn(async () => ({
    data: {
      html_url: "https://github.com/octo/repo/pull/42",
      number: 42
    }
  }));
  return {
    context: {
      eventName: "issues",
      payload: {
        repository: {
          default_branch: "main"
        }
      },
      repo: {
        owner: "octo",
        repo: "repo"
      }
    },
    createPullRequest,
    getOctokit: vi.fn(() => ({
      rest: {
        pulls: {
          create: createPullRequest
        }
      }
    }))
  };
});

vi.mock("@actions/core", () => coreMock);
vi.mock("@actions/github", () => githubMock);

const originalCwd = process.cwd();
const originalActionSecret = process.env.ACTION_TEST_SECRET;

describe("@metaharness/github-action", () => {
  beforeEach(() => {
    coreMock.inputs.clear();
    coreMock.outputs.clear();
    coreMock.failed.length = 0;
    coreMock.infos.length = 0;
    coreMock.secrets.length = 0;
    coreMock.warnings.length = 0;
    githubMock.context.eventName = "issues";
    process.env.ACTION_TEST_SECRET = "action-secret-value";
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalActionSecret === undefined) {
      delete process.env.ACTION_TEST_SECRET;
    } else {
      process.env.ACTION_TEST_SECRET = originalActionSecret;
    }
  });

  it("runs the mock provider and writes action outputs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-run-"));
    process.chdir(cwd);
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "action task");
    coreMock.inputs.set("verify", "node --version");

    await runAction();

    expect(coreMock.failed).toEqual([]);
    expect(coreMock.outputs.get("final-message")).toContain(
      "Mock completed: action task"
    );
    expect(await exists(coreMock.outputs.get("patch-file") ?? "")).toBe(true);
    expect(await exists(coreMock.outputs.get("ledger-file") ?? "")).toBe(true);
    expect(await exists(coreMock.outputs.get("handoff-file") ?? "")).toBe(true);
    expect(coreMock.outputs.get("pull-request-url")).toBe("");
    expect(coreMock.secrets).toContain("action-secret-value");
    expect(coreMock.infos.some((message) => message.includes("mock"))).toBe(true);
  });

  it("warns when pull request creation is requested without a token", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-pr-"));
    process.chdir(cwd);
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "open pr task");
    coreMock.inputs.set("open-pull-request", "true");

    await runAction();

    expect(coreMock.failed).toEqual([]);
    expect(githubMock.getOctokit).not.toHaveBeenCalled();
    expect(
      coreMock.warnings.some((message) =>
        message.includes("github-token was not provided")
      )
    ).toBe(true);
  });

  it("opens a pull request from committed workspace changes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-pr-success-"));
    const gitCommands: Array<{
      args: string[];
      options?: ActionGitOptions;
    }> = [];
    const git: ActionGitRunner = async (_cwd, args, options) => {
      const command: {
        args: string[];
        options?: ActionGitOptions;
      } = {
        args: [...args]
      };
      if (options) {
        command.options = options;
      }
      gitCommands.push(command);
      if (args.join("\0") === "diff\0--cached\0--quiet") {
        return {
          exitCode: 1,
          stderr: "",
          stdout: ""
        };
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: ""
      };
    };

    const summary = await executeAction(
      {
        allowPullRequestTarget: false,
        configFile: "metaharness.config.ts",
        githubToken: "ghs_test_token",
        openPullRequest: true,
        policyFile: "metaharness.policy.yaml",
        provider: "mock",
        task: "open a pull request",
        verify: []
      },
      {
        cwd,
        git,
        harness: fakeHarness(
          {
            artifacts: [],
            finalMessage: "changed files",
            provider: "mock",
            runId: "mock-run-pr",
            sessionId: "mock-session",
            status: "success"
          },
          cwd
        )
      }
    );

    expect(summary.pullRequest).toEqual({
      branch: "metaharness/mock-run-pr",
      number: 42,
      url: "https://github.com/octo/repo/pull/42"
    });
    expect(gitCommands.map((command) => command.args)).toEqual([
      ["checkout", "-B", "metaharness/mock-run-pr"],
      ["add", "--all", "--", ".", ":!.harness"],
      ["diff", "--cached", "--quiet"],
      ["config", "user.name", "metaharness[bot]"],
      ["config", "user.email", "metaharness[bot]@users.noreply.github.com"],
      ["commit", "-m", "metaharness: apply mock-run-pr"],
      [
        "push",
        "https://github.com/octo/repo.git",
        "HEAD:refs/heads/metaharness/mock-run-pr"
      ]
    ]);
    const pushCommand = gitCommands.at(-1);
    expect(pushCommand?.args.join(" ")).not.toContain("ghs_test_token");
    expect(pushCommand?.options?.env).toEqual(
      expect.objectContaining({
        GIT_TERMINAL_PROMPT: "0",
        METAHARNESS_GITHUB_TOKEN: "ghs_test_token"
      })
    );
    expect(pushCommand?.options?.env?.GIT_ASKPASS).toContain("metaharness-git-askpass-");
    expect(pushCommand?.options?.redactedSecrets).toEqual(["ghs_test_token"]);
    expect(githubMock.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        base: "main",
        head: "metaharness/mock-run-pr",
        owner: "octo",
        repo: "repo",
        title: "metaharness: mock run mock-run-pr"
      })
    );
    expect(coreMock.outputs.get("pull-request-url")).toBe(
      "https://github.com/octo/repo/pull/42"
    );
    expect(coreMock.outputs.get("pull-request-number")).toBe("42");
    expect(coreMock.outputs.get("pull-request-branch")).toBe("metaharness/mock-run-pr");
  });

  it("does not open a pull request when only .harness artifacts changed", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-pr-empty-"));
    const gitCommands: string[][] = [];
    const git: ActionGitRunner = async (_cwd, args) => {
      gitCommands.push([...args]);
      return {
        exitCode: 0,
        stderr: "",
        stdout: ""
      };
    };

    await executeAction(
      {
        allowPullRequestTarget: false,
        configFile: "metaharness.config.ts",
        githubToken: "ghs_test_token",
        openPullRequest: true,
        policyFile: "metaharness.policy.yaml",
        provider: "mock",
        task: "no workspace changes",
        verify: []
      },
      {
        cwd,
        git,
        harness: fakeHarness(
          {
            artifacts: [],
            finalMessage: "no changes",
            provider: "mock",
            runId: "mock-run-empty",
            sessionId: "mock-session",
            status: "success"
          },
          cwd
        )
      }
    );

    expect(githubMock.createPullRequest).not.toHaveBeenCalled();
    expect(gitCommands).toEqual([
      ["checkout", "-B", "metaharness/mock-run-empty"],
      ["add", "--all", "--", ".", ":!.harness"],
      ["diff", "--cached", "--quiet"]
    ]);
    expect(coreMock.outputs.get("pull-request-url")).toBe("");
    expect(
      coreMock.warnings.some((message) =>
        message.includes("did not leave commit-ready workspace changes")
      )
    ).toBe(true);
  });

  it("fails with a typed code when staged diff inspection fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-pr-diff-error-"));
    const git: ActionGitRunner = async (_cwd, args) => {
      if (args.join("\0") === "diff\0--cached\0--quiet") {
        return {
          exitCode: 2,
          stderr: "fatal: diff failed",
          stdout: ""
        };
      }
      return {
        exitCode: 0,
        stderr: "",
        stdout: ""
      };
    };

    await expect(
      executeAction(
        {
          allowPullRequestTarget: false,
          configFile: "metaharness.config.ts",
          githubToken: "ghs_test_token",
          openPullRequest: true,
          policyFile: "metaharness.policy.yaml",
          provider: "mock",
          task: "diff fails",
          verify: []
        },
        {
          cwd,
          git,
          harness: fakeHarness(
            {
              artifacts: [],
              finalMessage: "changed files",
              provider: "mock",
              runId: "mock-run-diff-error",
              sessionId: "mock-session",
              status: "success"
            },
            cwd
          )
        }
      )
    ).rejects.toMatchObject({
      code: "ACTION_PULL_REQUEST_DIFF_ERROR",
      message: expect.stringContaining(
        "Unable to inspect staged changes before opening a pull request."
      )
    });
  });

  it("writes outputs but fails the action when the final run result is non-success", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-run-failed-"));
    const gitCommands: string[][] = [];
    const git: ActionGitRunner = async (_cwd, args) => {
      gitCommands.push([...args]);
      return {
        exitCode: 0,
        stderr: "",
        stdout: ""
      };
    };

    await expect(
      executeAction(
        {
          allowPullRequestTarget: false,
          configFile: "metaharness.config.ts",
          githubToken: "ghs_test_token",
          openPullRequest: true,
          policyFile: "metaharness.policy.yaml",
          provider: "mock",
          task: "failed run",
          verify: []
        },
        {
          cwd,
          git,
          harness: fakeHarness(
            {
              artifacts: [],
              finalMessage: "verification failed",
              provider: "mock",
              runId: "mock-run-failed",
              sessionId: "mock-session",
              status: "failed"
            },
            cwd
          )
        }
      )
    ).rejects.toMatchObject({
      code: "ACTION_RUN_FAILED",
      message: expect.stringContaining("metaharness run mock-run-failed failed")
    });

    expect(coreMock.outputs.get("run-id")).toBe("mock-run-failed");
    expect(coreMock.outputs.get("status")).toBe("failed");
    expect(coreMock.outputs.get("final-message")).toBe("verification failed");
    expect(coreMock.outputs.get("pull-request-url")).toBe("");
    expect(gitCommands).toEqual([]);
    expect(githubMock.createPullRequest).not.toHaveBeenCalled();
    expect(
      coreMock.warnings.some((message) => message.includes("finished with status failed"))
    ).toBe(true);
  });

  it("fails when both task and task-file are supplied", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-input-"));
    process.chdir(cwd);
    await writeFile(join(cwd, "task.md"), "task from file", "utf8");
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "inline task");
    coreMock.inputs.set("task-file", "task.md");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_TASK_INPUT_CONFLICT:");
    expect(coreMock.failed[0]).toContain("Use either task or task-file");
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails with task-file workspace guidance when the prompt file is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-missing-task-"));
    process.chdir(cwd);
    const taskPath = join(process.cwd(), "missing-task.md");
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task-file", "missing-task.md");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_TASK_FILE_NOT_FOUND:");
    expect(coreMock.failed[0]).toContain(`Task file not found: ${taskPath}`);
    expect(coreMock.failed[0]).toContain(
      "task-file input is resolved relative to the checked-out workspace"
    );
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails before running when task input is blank", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-blank-task-"));
    process.chdir(cwd);
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "   ");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_TASK_MISSING:");
    expect(coreMock.failed[0]).toContain("non-whitespace text");
    expect(coreMock.failed[0]).not.toContain("RUN_TASK_MISSING");
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails before running when task-file is empty", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-empty-task-file-"));
    process.chdir(cwd);
    const taskPath = join(process.cwd(), "empty-task.md");
    await writeFile(taskPath, "\n \t\n", "utf8");
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task-file", "empty-task.md");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_TASK_MISSING:");
    expect(coreMock.failed[0]).toContain(`Task file is empty: ${taskPath}`);
    expect(coreMock.failed[0]).toContain("non-whitespace prompt text");
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails when an explicit config-file input is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-missing-config-"));
    process.chdir(cwd);
    const configPath = join(process.cwd(), "missing.config.ts");
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "use missing config");
    coreMock.inputs.set("config-file", "missing.config.ts");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_CONFIG_NOT_FOUND:");
    expect(coreMock.failed[0]).toContain(`Config file not found: ${configPath}`);
    expect(coreMock.failed[0]).toContain(
      "config-file input is resolved relative to the checked-out workspace"
    );
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails with config-file guidance when config import fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-bad-config-"));
    process.chdir(cwd);
    const configPath = join(process.cwd(), "metaharness.config.ts");
    await writeFile(
      configPath,
      `import "missing-action-config-package";
export default {
  workspace: {
    cwd: process.cwd()
  }
};
`,
      "utf8"
    );
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "use bad config");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_CONFIG_IMPORT_ERROR:");
    expect(coreMock.failed[0]).toContain(`Failed to import config file "${configPath}"`);
    expect(coreMock.failed[0]).toContain("Keep metaharness.config.ts as plain ESM");
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails with schema diagnostics when action config is invalid", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-invalid-config-"));
    process.chdir(cwd);
    const configPath = join(process.cwd(), "metaharness.config.ts");
    await writeFile(
      configPath,
      `export default {
  workspace: { cwd: process.cwd() },
  defaultProvider: "openai",
  providers: {
    openai: { provider: "codex" },
    mock: { provider: "codex", runtime: "serverless" }
  }
};
`,
      "utf8"
    );
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "use invalid config");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_CONFIG_INVALID:");
    expect(coreMock.failed[0]).toContain(`Config file "${configPath}" is invalid:`);
    expect(coreMock.failed[0]).toContain('Unsupported defaultProvider "openai"');
    expect(coreMock.failed[0]).toContain("providers.openai is not supported");
    expect(coreMock.failed[0]).toContain(
      'providers.mock.provider must be "mock", got "codex"'
    );
    expect(coreMock.failed[0]).toContain("providers.mock.runtime");
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails when an explicit policy-file input is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-missing-policy-"));
    process.chdir(cwd);
    const policyPath = join(process.cwd(), "missing.policy.yaml");
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "use missing policy");
    coreMock.inputs.set("policy-file", "missing.policy.yaml");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_POLICY_NOT_FOUND:");
    expect(coreMock.failed[0]).toContain(`Policy file not found: ${policyPath}`);
    expect(coreMock.failed[0]).toContain(
      "policy-file input is resolved relative to the checked-out workspace"
    );
    expect(coreMock.outputs.size).toBe(0);
  });

  it("refuses pull_request_target by default", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-pr-target-"));
    process.chdir(cwd);
    githubMock.context.eventName = "pull_request_target";
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "untrusted pull request task");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_PULL_REQUEST_TARGET_UNSAFE:");
    expect(coreMock.failed[0]).toContain("pull_request_target");
    expect(coreMock.outputs.size).toBe(0);
  });

  it("fails with typed provider input errors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-provider-error-"));
    process.chdir(cwd);
    coreMock.inputs.set("task", "missing provider");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_PROVIDER_MISSING:");
    expect(coreMock.failed[0]).toContain("Missing provider input.");
    expect(coreMock.outputs.size).toBe(0);

    coreMock.failed.length = 0;
    coreMock.inputs.set("provider", "openai");

    await runAction();

    expect(coreMock.failed[0]).toContain("ACTION_PROVIDER_UNSUPPORTED:");
    expect(coreMock.failed[0]).toContain('Unsupported provider "openai".');
    expect(coreMock.outputs.size).toBe(0);
  });

  it("allows pull_request_target only when explicitly opted in", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-action-pr-target-allow-"));
    process.chdir(cwd);
    githubMock.context.eventName = "pull_request_target";
    coreMock.inputs.set("provider", "mock");
    coreMock.inputs.set("task", "trusted pull request task");
    coreMock.inputs.set("allow-pull-request-target", "true");

    await runAction();

    expect(coreMock.failed).toEqual([]);
    expect(coreMock.outputs.get("final-message")).toContain(
      "Mock completed: trusted pull request task"
    );
    expect(
      coreMock.warnings.some((message) =>
        message.includes("allow-pull-request-target=true")
      )
    ).toBe(true);
  });
});

function fakeHarness(result: RunResult, cwd: string): Harness {
  return {
    agent: vi.fn(),
    compare: vi.fn(),
    dispose: vi.fn(),
    doctor: vi.fn(),
    exportLedger: vi.fn(),
    handoff: vi.fn(),
    importLedger: vi.fn(),
    resume: vi.fn(),
    run: vi.fn(async () => {
      await writeFile(join(cwd, "changed.txt"), "changed\n", "utf8");
      return result;
    }),
    startResume: vi.fn(),
    startRun: vi.fn()
  } as unknown as Harness;
}

async function exists(path: string): Promise<boolean> {
  if (!path) {
    return false;
  }
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
