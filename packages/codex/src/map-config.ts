import type {
  CodexApprovalPolicy,
  CodexOptionsLike,
  CodexSandboxMode,
  CodexThreadOptionsLike,
  CodexTurnOptionsLike,
  CodexWebSearchMode,
  MetaharnessCodexSandboxMode
} from "./types.js";
import type {
  CodexAppServerClientConfig,
  CodexAppServerThreadResumeParamsLike,
  CodexAppServerThreadStartParamsLike,
  CodexAppServerTurnStartParamsLike
} from "./appserver/protocol.js";
import { ProviderConfigError } from "@metaharness/core";
import type { RunInput, StartSessionConfig } from "@metaharness/core";

const CODEX_OPTION_KEYS = [
  "apiKey",
  "baseUrl",
  "codexPathOverride",
  "config",
  "env"
] as const;

const THREAD_OPTION_KEYS = [
  "additionalDirectories",
  "approvalPolicy",
  "modelReasoningEffort",
  "networkAccessEnabled",
  "sandboxMode",
  "skipGitRepoCheck",
  "webSearchEnabled",
  "webSearchMode"
] as const;

const TURN_OPTION_KEYS = ["outputSchema"] as const;

export type CodexAdapterMode = "sdk" | "app-server";

export function buildCodexOptions(config: StartSessionConfig): CodexOptionsLike {
  const native = nativeConfig(config.native);
  const explicitOptions = recordAt(native, "codexOptions");
  const options: CodexOptionsLike = {};
  applyCodexOptions(options, native);
  applyCodexOptions(options, explicitOptions);

  const apiKey = resolveApiKey(config);
  if (apiKey && !options.apiKey) {
    options.apiKey = apiKey;
  }

  if (options.env && apiKey) {
    options.env = {
      ...options.env
    };
    if (!options.env.OPENAI_API_KEY) {
      options.env.OPENAI_API_KEY = apiKey;
    }
    if (!options.env.CODEX_API_KEY) {
      options.env.CODEX_API_KEY = apiKey;
    }
  }

  return options;
}

export function buildCodexThreadOptions(
  config: StartSessionConfig
): CodexThreadOptionsLike {
  const native = nativeConfig(config.native);
  const explicitOptions = recordAt(native, "threadOptions");
  const threadOptions: CodexThreadOptionsLike = {};
  applyThreadOptions(threadOptions, native);
  applyThreadOptions(threadOptions, explicitOptions);
  threadOptions.workingDirectory = config.workspace.cwd;

  if (config.model && !threadOptions.model) {
    threadOptions.model = config.model;
  }

  if (threadOptions.skipGitRepoCheck === undefined) {
    threadOptions.skipGitRepoCheck = true;
  }

  const sandbox = valueAt(native, "sandbox") ?? valueAt(native, "sandboxMode");
  if (typeof sandbox === "string") {
    threadOptions.sandboxMode = mapCodexSandboxMode(sandbox);
  }

  return threadOptions;
}

export function buildCodexTurnOptions(
  input: RunInput,
  abortController: AbortController
): CodexTurnOptionsLike {
  const native = nativeConfig(input.native);
  const explicitOptions = recordAt(native, "turnOptions");
  const turnOptions: CodexTurnOptionsLike = {
    signal: abortController.signal
  };
  applyTurnOptions(turnOptions, native);
  applyTurnOptions(turnOptions, explicitOptions);
  return turnOptions;
}

export function resolveCodexMode(
  config: Pick<StartSessionConfig, "native"> | Pick<RunInput, "native">
): CodexAdapterMode {
  const native = nativeConfig(config.native);
  const mode = valueAt(native, "mode");
  return mode === "app-server" ? "app-server" : "sdk";
}

export function buildCodexAppServerClientConfig(
  config: StartSessionConfig
): CodexAppServerClientConfig {
  const native = nativeConfig(config.native);
  const appServer = recordAt(native, "appServer");
  const command =
    stringAt(appServer, "command") ??
    stringAt(native, "codexPathOverride") ??
    stringAt(native, "codexPath") ??
    "codex";
  const listen = stringAt(appServer, "listen") ?? "stdio://";
  const args = stringArrayAt(appServer, "args") ?? ["app-server", "--listen", listen];
  const env = {
    ...resolveCodexEnv(config),
    ...(isStringRecord(appServer?.env) ? appServer.env : {})
  };
  return {
    args,
    command,
    env,
    requestTimeoutMs: numberAt(appServer, "requestTimeoutMs") ?? 60_000
  };
}

export function buildCodexAppServerThreadStartParams(
  config: StartSessionConfig
): CodexAppServerThreadStartParamsLike {
  const native = nativeConfig(config.native);
  const appServer = recordAt(native, "appServer");
  const explicitParams = recordAt(appServer, "threadParams");
  const params: CodexAppServerThreadStartParamsLike = {
    cwd: config.workspace.cwd,
    experimentalRawEvents: false,
    persistExtendedHistory: false
  };
  applyAppServerThreadParams(params, native);
  applyAppServerThreadParams(params, appServer);
  applyAppServerThreadParams(params, explicitParams);
  if (config.model && !params.model) {
    params.model = config.model;
  }
  const sandbox = valueAt(native, "sandbox") ?? valueAt(native, "sandboxMode");
  if (typeof sandbox === "string") {
    params.sandbox = mapCodexSandboxMode(sandbox);
  }
  return params;
}

export function buildCodexAppServerThreadResumeParams(
  config: StartSessionConfig,
  nativeSessionId: string
): CodexAppServerThreadResumeParamsLike {
  const params = buildCodexAppServerThreadStartParams(config);
  return {
    ...params,
    persistExtendedHistory: params.persistExtendedHistory,
    threadId: nativeSessionId
  };
}

export function buildCodexAppServerTurnStartParams(
  threadId: string,
  input: RunInput
): CodexAppServerTurnStartParamsLike {
  const native = nativeConfig(input.native);
  const appServer = recordAt(native, "appServer");
  const explicitParams = recordAt(appServer, "turnParams");
  const params: CodexAppServerTurnStartParamsLike = {
    input: [
      {
        text: input.task,
        type: "text"
      }
    ],
    threadId
  };
  const cwd = input.workspace?.cwd;
  if (cwd) {
    params.cwd = cwd;
  }
  if (input.model) {
    params.model = input.model;
  }
  applyAppServerTurnParams(params, native);
  applyAppServerTurnParams(params, appServer);
  applyAppServerTurnParams(params, explicitParams);
  return params;
}

export function mapCodexSandboxMode(mode: string): CodexSandboxMode {
  const normalized = mode.trim();
  if (normalized === "full-access" || normalized === "danger-full-access") {
    return "danger-full-access";
  }
  if (normalized === "read-only" || normalized === "workspace-write") {
    return normalized;
  }
  throw new ProviderConfigError(
    "codex",
    `Unsupported Codex sandbox mode "${mode}". Expected read-only, workspace-write, or full-access.`,
    "CODEX_SANDBOX_MODE_UNSUPPORTED",
    {
      option: "sandboxMode"
    }
  );
}

export function mapMetaharnessSandboxMode(
  mode: MetaharnessCodexSandboxMode
): CodexSandboxMode {
  return mapCodexSandboxMode(mode);
}

function resolveApiKey(config: StartSessionConfig): string | undefined {
  const apiKeyEnv = config.apiKeyEnv ?? "OPENAI_API_KEY";
  return (
    config.auth?.apiKey ??
    config.auth?.[apiKeyEnv] ??
    process.env[apiKeyEnv] ??
    process.env.CODEX_API_KEY
  );
}

function resolveCodexEnv(config: StartSessionConfig): Record<string, string> {
  const apiKey = resolveApiKey(config);
  const env: Record<string, string> = {};
  if (apiKey) {
    env.OPENAI_API_KEY = apiKey;
    env.CODEX_API_KEY = apiKey;
  }
  const native = nativeConfig(config.native);
  const codexOptions = recordAt(native, "codexOptions");
  if (isStringRecord(native.env)) {
    Object.assign(env, native.env);
  }
  if (isStringRecord(codexOptions?.env)) {
    Object.assign(env, codexOptions.env);
  }
  return env;
}

function nativeConfig(
  value: Record<string, unknown> | undefined
): Record<string, unknown> {
  const scoped = recordAt(value, "codex");
  if (scoped) {
    return scoped;
  }
  return value ?? {};
}

function recordAt(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const nested = value?.[key];
  if (isRecord(nested)) {
    return nested;
  }
  return undefined;
}

function valueAt(value: Record<string, unknown> | undefined, key: string): unknown {
  return value?.[key];
}

function stringAt(
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function numberAt(
  value: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" ? candidate : undefined;
}

function stringArrayAt(
  value: Record<string, unknown> | undefined,
  key: string
): string[] | undefined {
  const candidate = value?.[key];
  return Array.isArray(candidate) && candidate.every((item) => typeof item === "string")
    ? candidate
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function applyCodexOptions(
  options: CodexOptionsLike,
  value: Record<string, unknown> | undefined
): void {
  if (!value) {
    return;
  }
  for (const key of CODEX_OPTION_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) {
      continue;
    }
    switch (key) {
      case "apiKey":
      case "baseUrl":
      case "codexPathOverride":
        if (typeof candidate === "string") {
          options[key] = candidate;
        }
        break;
      case "config":
        if (isRecord(candidate)) {
          options.config = candidate;
        }
        break;
      case "env":
        if (isStringRecord(candidate)) {
          options.env = candidate;
        }
        break;
    }
  }
}

function applyThreadOptions(
  options: CodexThreadOptionsLike,
  value: Record<string, unknown> | undefined
): void {
  if (!value) {
    return;
  }
  for (const key of THREAD_OPTION_KEYS) {
    const candidate = value[key];
    if (candidate === undefined) {
      continue;
    }
    switch (key) {
      case "additionalDirectories":
        if (
          Array.isArray(candidate) &&
          candidate.every((item) => typeof item === "string")
        ) {
          options.additionalDirectories = candidate;
        }
        break;
      case "approvalPolicy":
        if (isCodexApprovalPolicy(candidate)) {
          options.approvalPolicy = candidate;
        }
        break;
      case "modelReasoningEffort":
        if (
          candidate === "minimal" ||
          candidate === "low" ||
          candidate === "medium" ||
          candidate === "high" ||
          candidate === "xhigh"
        ) {
          options.modelReasoningEffort = candidate;
        }
        break;
      case "networkAccessEnabled":
      case "skipGitRepoCheck":
      case "webSearchEnabled":
        if (typeof candidate === "boolean") {
          options[key] = candidate;
        }
        break;
      case "sandboxMode":
        if (typeof candidate === "string") {
          options.sandboxMode = mapCodexSandboxMode(candidate);
        }
        break;
      case "webSearchMode":
        if (isCodexWebSearchMode(candidate)) {
          options.webSearchMode = candidate;
        }
        break;
    }
  }
}

function applyTurnOptions(
  options: CodexTurnOptionsLike,
  value: Record<string, unknown> | undefined
): void {
  if (!value) {
    return;
  }
  for (const key of TURN_OPTION_KEYS) {
    if (key in value) {
      options[key] = value[key];
    }
  }
}

function applyAppServerThreadParams(
  params: CodexAppServerThreadStartParamsLike,
  value: Record<string, unknown> | undefined
): void {
  if (!value) {
    return;
  }
  if (typeof value.model === "string") {
    params.model = value.model;
  }
  if (typeof value.modelProvider === "string") {
    params.modelProvider = value.modelProvider;
  }
  if (
    isCodexApprovalPolicy(value.approvalPolicy) ||
    isGranularApprovalPolicy(value.approvalPolicy)
  ) {
    params.approvalPolicy = value.approvalPolicy;
  }
  if (typeof value.sandbox === "string") {
    params.sandbox = mapCodexSandboxMode(value.sandbox);
  }
  if (typeof value.sandboxMode === "string") {
    params.sandbox = mapCodexSandboxMode(value.sandboxMode);
  }
  if (isRecord(value.config)) {
    params.config = value.config;
  }
  if (typeof value.baseInstructions === "string") {
    params.baseInstructions = value.baseInstructions;
  }
  if (typeof value.developerInstructions === "string") {
    params.developerInstructions = value.developerInstructions;
  }
  if (typeof value.personality === "string") {
    params.personality = value.personality;
  }
  if (typeof value.ephemeral === "boolean") {
    params.ephemeral = value.ephemeral;
  }
  if (typeof value.experimentalRawEvents === "boolean") {
    params.experimentalRawEvents = value.experimentalRawEvents;
  }
  if (typeof value.persistExtendedHistory === "boolean") {
    params.persistExtendedHistory = value.persistExtendedHistory;
  }
  if ("approvalsReviewer" in value) {
    params.approvalsReviewer = value.approvalsReviewer;
  }
  if ("permissionProfile" in value) {
    params.permissionProfile = value.permissionProfile;
  }
  if ("serviceName" in value && typeof value.serviceName === "string") {
    params.serviceName = value.serviceName;
  }
  if ("serviceTier" in value && typeof value.serviceTier === "string") {
    params.serviceTier = value.serviceTier;
  }
  if ("sessionStartSource" in value) {
    params.sessionStartSource = value.sessionStartSource;
  }
}

function applyAppServerTurnParams(
  params: CodexAppServerTurnStartParamsLike,
  value: Record<string, unknown> | undefined
): void {
  if (!value) {
    return;
  }
  if (typeof value.model === "string") {
    params.model = value.model;
  }
  if (
    isCodexApprovalPolicy(value.approvalPolicy) ||
    isGranularApprovalPolicy(value.approvalPolicy)
  ) {
    params.approvalPolicy = value.approvalPolicy;
  }
  const effort = isReasoningEffort(value.effort)
    ? value.effort
    : isReasoningEffort(value.modelReasoningEffort)
      ? value.modelReasoningEffort
      : undefined;
  if (effort) {
    params.effort = effort;
  }
  if (typeof value.summary === "string") {
    params.summary = value.summary;
  }
  if (typeof value.personality === "string") {
    params.personality = value.personality;
  }
  if ("outputSchema" in value) {
    params.outputSchema = value.outputSchema;
  }
  if ("sandboxPolicy" in value) {
    params.sandboxPolicy = value.sandboxPolicy;
  }
  if ("permissionProfile" in value) {
    params.permissionProfile = value.permissionProfile;
  }
  if ("approvalsReviewer" in value) {
    params.approvalsReviewer = value.approvalsReviewer;
  }
  if ("collaborationMode" in value) {
    params.collaborationMode = value.collaborationMode;
  }
  if ("serviceTier" in value && typeof value.serviceTier === "string") {
    params.serviceTier = value.serviceTier;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) && Object.values(value).every((item) => typeof item === "string")
  );
}

export function isCodexApprovalPolicy(value: unknown): value is CodexApprovalPolicy {
  return (
    value === "never" ||
    value === "on-request" ||
    value === "on-failure" ||
    value === "untrusted"
  );
}

export function isCodexWebSearchMode(value: unknown): value is CodexWebSearchMode {
  return value === "disabled" || value === "cached" || value === "live";
}

function isReasoningEffort(
  value: unknown
): value is "minimal" | "low" | "medium" | "high" | "xhigh" {
  return (
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function isGranularApprovalPolicy(
  value: unknown
): value is NonNullable<CodexAppServerThreadStartParamsLike["approvalPolicy"]> {
  return (
    isRecord(value) &&
    isRecord(value.granular) &&
    typeof value.granular.sandbox_approval === "boolean" &&
    typeof value.granular.rules === "boolean" &&
    typeof value.granular.skill_approval === "boolean" &&
    typeof value.granular.request_permissions === "boolean" &&
    typeof value.granular.mcp_elicitations === "boolean"
  );
}
