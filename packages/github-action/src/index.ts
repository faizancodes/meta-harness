import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MockAdapter } from "@metaharness/adapter-mock";
import { ClaudeAdapter } from "@metaharness/claude";
import { CodexAdapter } from "@metaharness/codex";
import {
  createHarness,
  HarnessError,
  isProviderId,
  redactValue,
  supportedProviderIdList,
  validateHarnessConfig
} from "@metaharness/core";
import { CursorAdapter } from "@metaharness/cursor";
import { parsePolicyFile } from "@metaharness/policy";
import * as core from "@actions/core";
import * as github from "@actions/github";
import type {
  CodingAgentAdapter,
  Harness,
  HarnessConfig,
  ProviderId,
  RunInput,
  RunResult
} from "@metaharness/core";

export interface ActionInputs {
  allowPullRequestTarget: boolean;
  configFile: string;
  configFileExplicit?: boolean;
  fallbackProvider?: ProviderId;
  githubToken?: string;
  openPullRequest: boolean;
  policyFile: string;
  policyFileExplicit?: boolean;
  provider: ProviderId;
  task?: string;
  taskFile?: string;
  verify: string[];
}

export interface ActionRunSummary {
  fallbackUsed: boolean;
  initialRun: RunResult;
  pullRequest?: ActionPullRequestSummary;
  result: RunResult;
}

export interface ActionPullRequestSummary {
  branch: string;
  number?: number;
  url?: string;
}

export interface ActionGitResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface ActionGitOptions {
  allowFailure?: boolean;
  env?: Record<string, string | undefined>;
  redactedSecrets?: string[];
}

export type ActionGitRunner = (
  cwd: string,
  args: readonly string[],
  options?: ActionGitOptions
) => Promise<ActionGitResult>;

export interface ActionExecutionOptions {
  cwd: string;
  git?: ActionGitRunner;
  harness?: Harness;
}

export async function runAction(): Promise<void> {
  try {
    const inputs = readActionInputs();
    await executeAction(inputs, {
      cwd: process.cwd()
    });
  } catch (error) {
    core.setFailed(normalizeError(error).message);
  }
}

export async function executeAction(
  inputs: ActionInputs,
  options: ActionExecutionOptions
): Promise<ActionRunSummary> {
  registerKnownSecrets(inputs.githubToken);
  assertSafeWorkflowEvent(inputs);
  const task = sanitizeTaskPrompt(await resolveTask(inputs, options.cwd));
  assertActionTaskText(task);
  const config = await loadActionConfig({
    configFile: inputs.configFile,
    configFileExplicit: inputs.configFileExplicit ?? false,
    cwd: options.cwd,
    provider: inputs.provider
  });
  const policyExists = await validatePolicyInput({
    cwd: options.cwd,
    policyFile: inputs.policyFile,
    policyFileExplicit: inputs.policyFileExplicit ?? false
  });

  const harness = options.harness ?? createActionHarness(config);
  core.info(`Running metaharness provider ${inputs.provider}.`);
  const runInput: RunInput & { provider: ProviderId } = {
    provider: inputs.provider,
    task
  };
  if (policyExists) {
    runInput.policy = {
      file: resolve(options.cwd, inputs.policyFile)
    };
  }
  if (inputs.verify.length > 0) {
    runInput.verification = inputs.verify;
  }

  const initialRun = await harness.run(runInput);
  let result = initialRun;
  let fallbackUsed = false;

  if (initialRun.status !== "success" && inputs.fallbackProvider) {
    core.warning(
      `Provider ${inputs.provider} finished with status ${initialRun.status}; handing off to ${inputs.fallbackProvider}.`
    );
    const handoff = await harness.handoff({
      fromRunId: initialRun.runId,
      toProvider: inputs.fallbackProvider,
      verification: inputs.verify
    });
    result = handoff.toRun;
    fallbackUsed = true;
  }

  const pullRequest =
    result.status === "success"
      ? await handlePullRequestInput(
          inputs,
          result,
          options.cwd,
          options.git ?? runActionGit
        )
      : warnSkippedPullRequestForFailedRun(inputs, result);
  writeOutputs(result, pullRequest);
  core.info(`metaharness run ${result.runId} finished with status ${result.status}.`);

  const summary: ActionRunSummary = {
    fallbackUsed,
    initialRun,
    result
  };
  if (pullRequest) {
    summary.pullRequest = pullRequest;
  }
  assertActionResultSucceeded(result);
  return summary;
}

export function readActionInputs(): ActionInputs {
  const provider = parseProvider(core.getInput("provider"), "provider");
  const fallbackProviderInput = core.getInput("fallback-provider");
  const fallbackProvider = fallbackProviderInput
    ? parseProvider(fallbackProviderInput, "fallback-provider")
    : undefined;
  const configFileInput = core.getInput("config-file");
  const githubToken = core.getInput("github-token");
  const policyFileInput = core.getInput("policy-file");
  if (githubToken) {
    core.setSecret(githubToken);
  }

  const inputs: ActionInputs = {
    allowPullRequestTarget: core.getBooleanInput("allow-pull-request-target"),
    configFile: configFileInput || "metaharness.config.ts",
    configFileExplicit: Boolean(configFileInput),
    openPullRequest: core.getBooleanInput("open-pull-request"),
    policyFile: policyFileInput || "metaharness.policy.yaml",
    policyFileExplicit: Boolean(policyFileInput),
    provider,
    verify: core
      .getMultilineInput("verify")
      .map((command) => command.trim())
      .filter(Boolean)
  };
  if (fallbackProvider) {
    inputs.fallbackProvider = fallbackProvider;
  }
  if (githubToken) {
    inputs.githubToken = githubToken;
  }
  const task = core.getInput("task");
  if (task) {
    inputs.task = task;
  }
  const taskFile = core.getInput("task-file");
  if (taskFile) {
    inputs.taskFile = taskFile;
  }
  return inputs;
}

function assertSafeWorkflowEvent(inputs: ActionInputs): void {
  if (github.context.eventName !== "pull_request_target") {
    return;
  }
  if (inputs.allowPullRequestTarget) {
    core.warning(
      "allow-pull-request-target=true was set. Ensure this workflow never passes untrusted pull request content to provider prompts or verification commands."
    );
    return;
  }
  throw new HarnessError(
    "Refusing to run metaharness on pull_request_target by default. This event can expose elevated secrets and write permissions to untrusted pull request content. Use a safer event or set allow-pull-request-target=true only after adding explicit trust checks.",
    "ACTION_PULL_REQUEST_TARGET_UNSAFE"
  );
}

export function createActionHarness(config: HarnessConfig): Harness {
  return createHarness(config, createActionAdapters());
}

export function createActionAdapters(): CodingAgentAdapter[] {
  return [
    new MockAdapter(),
    new ClaudeAdapter(),
    new CodexAdapter(),
    new CursorAdapter()
  ];
}

async function resolveTask(inputs: ActionInputs, cwd: string): Promise<string> {
  if (inputs.task !== undefined && inputs.taskFile) {
    throw new HarnessError(
      "Use either task or task-file, not both.",
      "ACTION_TASK_INPUT_CONFLICT"
    );
  }
  if (inputs.taskFile) {
    const taskFilePath = resolve(cwd, inputs.taskFile);
    let task: string;
    try {
      task = await readFile(taskFilePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new HarnessError(
          [
            `Task file not found: ${taskFilePath}`,
            "The task-file input is resolved relative to the checked-out workspace. Create the file, fix task-file, or pass task instead."
          ].join("\n"),
          "ACTION_TASK_FILE_NOT_FOUND"
        );
      }
      if (isNodeError(error) && error.code === "EISDIR") {
        throw new HarnessError(
          [
            `Task file path is a directory: ${taskFilePath}`,
            "Pass task-file as a file path, or pass task for an inline prompt."
          ].join("\n"),
          "ACTION_TASK_FILE_PATH_INVALID"
        );
      }
      throw new HarnessError(
        `Unable to read task file "${taskFilePath}": ${formatUnknownError(error)}`,
        "ACTION_TASK_FILE_READ_ERROR"
      );
    }
    if (!hasTaskText(task)) {
      throw new HarnessError(
        [
          `Task file is empty: ${taskFilePath}`,
          "Pass a task-file with non-whitespace prompt text, or pass task for an inline prompt."
        ].join("\n"),
        "ACTION_TASK_MISSING"
      );
    }
    return task;
  }
  if (inputs.task !== undefined) {
    if (!hasTaskText(inputs.task)) {
      throw new HarnessError(
        "Task must contain non-whitespace text. Provide task or task-file.",
        "ACTION_TASK_MISSING"
      );
    }
    return inputs.task;
  }
  throw new HarnessError(
    "Missing task. Provide task or task-file.",
    "ACTION_TASK_MISSING"
  );
}

function assertActionTaskText(value: string): void {
  if (hasTaskText(value)) {
    return;
  }
  throw new HarnessError(
    "Task must contain non-whitespace text after GitHub Actions command sanitization.",
    "ACTION_TASK_MISSING"
  );
}

function hasTaskText(value: string): boolean {
  return value.trim().length > 0;
}

async function loadActionConfig(input: {
  configFile: string;
  configFileExplicit?: boolean;
  cwd: string;
  provider: ProviderId;
}): Promise<HarnessConfig> {
  const configPath = resolve(input.cwd, input.configFile);
  let configStats;
  try {
    configStats = await stat(configPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (input.configFileExplicit) {
        throw new HarnessError(
          [
            `Config file not found: ${configPath}`,
            "The config-file input is resolved relative to the checked-out workspace. Create the file, fix config-file, or omit config-file to use the default action config."
          ].join("\n"),
          "ACTION_CONFIG_NOT_FOUND"
        );
      }
      core.info(
        `Config file ${configPath} was not found; using the default metaharness action config.`
      );
      return defaultActionConfig(input.cwd, input.provider);
    }
    throw new HarnessError(
      `Unable to inspect config file "${configPath}": ${formatUnknownError(error)}`,
      "ACTION_CONFIG_READ_ERROR"
    );
  }
  if (!configStats.isFile()) {
    throw new HarnessError(
      [
        `Config file path is not a file: ${configPath}`,
        "Pass config-file as a file path, or omit config-file to use the default action config."
      ].join("\n"),
      "ACTION_CONFIG_PATH_INVALID"
    );
  }

  const previousCwd = process.cwd();
  let imported: {
    default?: unknown;
  };
  try {
    process.chdir(input.cwd);
    imported = (await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)) as {
      default?: unknown;
    };
  } catch (error) {
    throw new HarnessError(
      [
        `Failed to import config file "${configPath}": ${formatUnknownError(error)}`,
        "Keep metaharness.config.ts as plain ESM and avoid runtime imports unless the package is installed in the checked-out workspace."
      ].join("\n"),
      "ACTION_CONFIG_IMPORT_ERROR"
    );
  } finally {
    process.chdir(previousCwd);
  }
  const config = validateActionConfig(imported.default, configPath);
  return {
    ...config,
    defaultProvider: input.provider,
    workspace: {
      ...config.workspace,
      cwd: config.workspace.cwd || input.cwd
    }
  };
}

function defaultActionConfig(cwd: string, provider: ProviderId): HarnessConfig {
  return {
    defaultProvider: provider,
    providers: {
      claude: {
        provider: "claude"
      },
      codex: {
        provider: "codex"
      },
      cursor: {
        provider: "cursor"
      },
      mock: {
        provider: "mock"
      }
    },
    storage: {
      rootDir: ".harness"
    },
    workspace: {
      cwd
    }
  };
}

async function validatePolicyInput(input: {
  cwd: string;
  policyFile: string;
  policyFileExplicit?: boolean;
}): Promise<boolean> {
  const policyPath = resolve(input.cwd, input.policyFile);
  let policyStats;
  try {
    policyStats = await stat(policyPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (input.policyFileExplicit) {
        throw new HarnessError(
          [
            `Policy file not found: ${policyPath}`,
            "The policy-file input is resolved relative to the checked-out workspace. Create the file, fix policy-file, or omit policy-file to use provider defaults."
          ].join("\n"),
          "ACTION_POLICY_NOT_FOUND"
        );
      }
      core.warning(`Policy file ${policyPath} was not found; provider defaults apply.`);
      return false;
    }
    throw new HarnessError(
      `Unable to inspect policy file "${policyPath}": ${formatUnknownError(error)}`,
      "ACTION_POLICY_READ_ERROR"
    );
  }
  if (!policyStats.isFile()) {
    throw new HarnessError(
      [
        `Policy file path is not a file: ${policyPath}`,
        "Pass policy-file as a file path, or omit policy-file to use provider defaults."
      ].join("\n"),
      "ACTION_POLICY_PATH_INVALID"
    );
  }
  const parsed = await parsePolicyFile(policyPath);
  for (const warning of [
    ...parsed.diagnostics.warnings,
    ...parsed.diagnostics.providerWarnings
  ]) {
    core.warning(`${warning.code}: ${warning.message}`);
  }
  if (!parsed.diagnostics.ok) {
    const errors = parsed.diagnostics.errors
      .map((error) => `${error.code}: ${error.message}`)
      .join("\n");
    throw new HarnessError(
      `Policy validation failed:\n${errors}`,
      "ACTION_POLICY_INVALID"
    );
  }
  return true;
}

async function handlePullRequestInput(
  inputs: ActionInputs,
  result: RunResult,
  cwd: string,
  git: ActionGitRunner
): Promise<ActionPullRequestSummary | undefined> {
  if (!inputs.openPullRequest) {
    return undefined;
  }
  if (!inputs.githubToken) {
    core.warning(
      "open-pull-request=true was requested, but github-token was not provided. No pull request was opened."
    );
    return undefined;
  }

  const branch = prBranchName(result);
  await git(cwd, ["checkout", "-B", branch]);
  await git(cwd, ["add", "--all", "--", ".", ":!.harness"]);
  const diff = await git(cwd, ["diff", "--cached", "--quiet"], {
    allowFailure: true
  });
  if (diff.exitCode === 0) {
    core.warning(
      `open-pull-request=true was requested, but run ${result.runId} did not leave commit-ready workspace changes outside .harness. No pull request was opened.`
    );
    return undefined;
  }
  if (diff.exitCode !== 1) {
    throw new HarnessError(
      `Unable to inspect staged changes before opening a pull request. ${redactOutput(diff.stderr)}`,
      "ACTION_PULL_REQUEST_DIFF_ERROR"
    );
  }

  await git(cwd, ["config", "user.name", "metaharness[bot]"]);
  await git(cwd, ["config", "user.email", "metaharness[bot]@users.noreply.github.com"]);
  await git(cwd, ["commit", "-m", `metaharness: apply ${result.runId}`]);

  const askpass = await createGitAskpassHelper();
  try {
    await git(cwd, ["push", repositoryRemoteUrl(), `HEAD:refs/heads/${branch}`], {
      env: {
        GIT_ASKPASS: askpass.scriptPath,
        GIT_TERMINAL_PROMPT: "0",
        METAHARNESS_GITHUB_TOKEN: inputs.githubToken
      },
      redactedSecrets: [inputs.githubToken]
    });
  } finally {
    await askpass.cleanup();
  }

  const octokit = github.getOctokit(inputs.githubToken);
  const response = await octokit.rest.pulls.create({
    base: baseBranchName(),
    body: pullRequestBody(result),
    draft: false,
    head: branch,
    maintainer_can_modify: true,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    title: pullRequestTitle(result)
  });
  const pullRequest: ActionPullRequestSummary = {
    branch
  };
  if (typeof response.data.number === "number") {
    pullRequest.number = response.data.number;
  }
  if (typeof response.data.html_url === "string") {
    pullRequest.url = response.data.html_url;
  }
  core.info(
    `Opened metaharness pull request ${
      pullRequest.url ?? `#${pullRequest.number ?? "unknown"}`
    } from ${branch}.`
  );
  return pullRequest;
}

function writeOutputs(result: RunResult, pullRequest?: ActionPullRequestSummary): void {
  core.setOutput("run-id", result.runId);
  core.setOutput("status", result.status);
  core.setOutput("final-message", redactOutput(result.finalMessage ?? ""));
  core.setOutput("patch-file", result.patchPath ?? "");
  core.setOutput("ledger-file", result.ledgerPath ?? "");
  core.setOutput("handoff-file", result.handoffPath ?? "");
  core.setOutput("pull-request-url", pullRequest?.url ?? "");
  core.setOutput("pull-request-number", pullRequest?.number ?? "");
  core.setOutput("pull-request-branch", pullRequest?.branch ?? "");
}

function warnSkippedPullRequestForFailedRun(
  inputs: ActionInputs,
  result: RunResult
): undefined {
  if (inputs.openPullRequest) {
    core.warning(
      `open-pull-request=true was requested, but metaharness run ${result.runId} finished with status ${result.status}. No pull request was opened.`
    );
  }
  return undefined;
}

function assertActionResultSucceeded(result: RunResult): void {
  if (result.status === "success") {
    return;
  }
  const message = result.finalMessage
    ? ` ${redactOutput(result.finalMessage).slice(0, 500)}`
    : "";
  throw new HarnessError(
    `metaharness run ${result.runId} ${result.status}.${message}`,
    "ACTION_RUN_FAILED"
  );
}

function registerKnownSecrets(githubToken: string | undefined): void {
  if (githubToken) {
    core.setSecret(githubToken);
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (!value) {
      continue;
    }
    if (/(TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)/i.test(name)) {
      core.setSecret(value);
    }
  }
}

function sanitizeTaskPrompt(value: string): string {
  return value
    .replace(/\0/g, "")
    .split("\n")
    .map((line) => (line.startsWith("::") ? `: ${line.slice(2)}` : line))
    .join("\n")
    .slice(0, 200_000);
}

function redactOutput(value: string): string {
  return redactValue(value) as string;
}

function prBranchName(result: RunResult): string {
  return `metaharness/${sanitizeBranchSegment(result.runId)}`;
}

function baseBranchName(): string {
  const payload = github.context.payload as {
    pull_request?: {
      base?: {
        ref?: unknown;
      };
    };
    repository?: {
      default_branch?: unknown;
    };
  };
  const pullRequestBase = payload.pull_request?.base?.ref;
  if (typeof pullRequestBase === "string" && pullRequestBase.trim()) {
    return pullRequestBase.trim();
  }
  const defaultBranch = payload.repository?.default_branch;
  if (typeof defaultBranch === "string" && defaultBranch.trim()) {
    return defaultBranch.trim();
  }
  const envBase = process.env.GITHUB_BASE_REF ?? process.env.GITHUB_REF_NAME;
  return envBase?.trim() || "main";
}

function pullRequestTitle(result: RunResult): string {
  return `metaharness: ${result.provider} run ${result.runId}`;
}

function pullRequestBody(result: RunResult): string {
  return redactOutput(`Created by metaharness.

- Provider: ${result.provider}
- Run: ${result.runId}
- Status: ${result.status}
- Patch artifact: ${result.patchPath ?? "not captured"}
- Ledger artifact: ${result.ledgerPath ?? "not captured"}
- Handoff artifact: ${result.handoffPath ?? "not captured"}

## Final Message

${result.finalMessage ?? "No final message recorded."}
`);
}

function repositoryRemoteUrl(): string {
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const url = new URL(
    `/${github.context.repo.owner}/${github.context.repo.repo}.git`,
    serverUrl
  );
  return url.toString();
}

async function createGitAskpassHelper(): Promise<{
  cleanup(): Promise<void>;
  scriptPath: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "metaharness-git-askpass-"));
  const scriptPath = join(dir, "askpass.sh");
  await writeFile(
    scriptPath,
    `#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *Password*) printf '%s\\n' "$METAHARNESS_GITHUB_TOKEN" ;;
  *) printf '%s\\n' "$METAHARNESS_GITHUB_TOKEN" ;;
esac
`,
    "utf8"
  );
  await chmod(scriptPath, 0o700);
  return {
    cleanup: async () => {
      await rm(dir, {
        force: true,
        recursive: true
      });
    },
    scriptPath
  };
}

function sanitizeBranchSegment(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/^\/+|\/+$/g, "");
  return sanitized || "run";
}

async function runActionGit(
  cwd: string,
  args: readonly string[],
  options: ActionGitOptions = {}
): Promise<ActionGitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          ...(options.env ?? {})
        },
        maxBuffer: 50 * 1024 * 1024,
        shell: false
      },
      (error, stdout, stderr) => {
        const result: ActionGitResult = {
          exitCode: error ? exitCodeFromError(error) : 0,
          stderr: String(stderr ?? ""),
          stdout: String(stdout ?? "")
        };
        if (!error || options.allowFailure) {
          resolve(result);
          return;
        }
        reject(
          new HarnessError(
            `git ${redactGitArgs(args, options.redactedSecrets ?? []).join(
              " "
            )} failed with exit code ${result.exitCode}. ${redactKnownSecrets(
              result.stderr,
              options.redactedSecrets ?? []
            )}`.trim(),
            "ACTION_GIT_ERROR"
          )
        );
      }
    );
  });
}

function redactGitArgs(args: readonly string[], secrets: readonly string[]): string[] {
  return args.map((arg) => redactKnownSecrets(arg, secrets));
}

function redactKnownSecrets(value: string, secrets: readonly string[]): string {
  let redacted = redactOutput(value);
  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }
  return redacted;
}

function exitCodeFromError(error: Error): number {
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "number" ? maybeCode : 1;
}

function parseProvider(value: string, inputName: string): ProviderId {
  const normalized = value.trim();
  if (!normalized) {
    throw new HarnessError(`Missing ${inputName} input.`, "ACTION_PROVIDER_MISSING");
  }
  if (isProviderId(normalized)) {
    return normalized;
  }
  throw new HarnessError(
    `Unsupported provider "${value}". Supported providers: ${supportedProviderIdList}.`,
    "ACTION_PROVIDER_UNSUPPORTED"
  );
}

function validateActionConfig(value: unknown, configPath: string): HarnessConfig {
  const validation = validateHarnessConfig(value);
  if (!validation.success && validation.reason === "not_object") {
    throw new HarnessError(
      `Config file "${configPath}" does not export a metaharness config object.`,
      "ACTION_CONFIG_INVALID"
    );
  }

  if (!validation.success) {
    throw new HarnessError(
      [
        `Config file "${configPath}" is invalid:`,
        ...validation.diagnostics.map((item) => `  - ${item}`)
      ].join("\n"),
      "ACTION_CONFIG_INVALID"
    );
  }

  return validation.config;
}

function normalizeError(error: unknown): Error {
  if (error instanceof HarnessError) {
    return new Error(`${error.code}: ${error.message}`);
  }
  return error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  await runAction();
}
