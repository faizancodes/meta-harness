import { resolve } from "node:path";
import {
  checkCommandPolicy,
  compileProviderPolicy,
  defaultPolicy,
  parsePolicyFile,
  validatePolicy
} from "@metaharness/policy";
import type {
  ClaudeCanUseTool,
  ClaudeOptionsLike,
  ClaudePermissionResult
} from "./types.js";
import { ProviderConfigError } from "@metaharness/core";
import type {
  ResumeSessionConfig,
  RunInput,
  StartSessionConfig
} from "@metaharness/core";
import type { EffectivePolicy } from "@metaharness/policy";

const CLAUDE_PASSTHROUGH_KEYS = [
  "additionalDirectories",
  "allowDangerouslySkipPermissions",
  "allowedTools",
  "canUseTool",
  "disallowedTools",
  "enableFileCheckpointing",
  "env",
  "extraArgs",
  "fallbackModel",
  "forkSession",
  "hooks",
  "includeHookEvents",
  "includePartialMessages",
  "maxBudgetUsd",
  "maxTurns",
  "mcpServers",
  "model",
  "outputFormat",
  "pathToClaudeCodeExecutable",
  "permissionMode",
  "permissionPromptToolName",
  "persistSession",
  "resume",
  "resumeSessionAt",
  "sandbox",
  "sessionId",
  "sessionStore",
  "settingSources",
  "strictMcpConfig",
  "systemPrompt",
  "tools"
] as const;

export async function buildClaudeRunOptions(input: {
  abortController: AbortController;
  runInput: RunInput;
  sessionConfig: ClaudeSessionConfigSnapshot;
  sessionNativeId?: string;
}): Promise<ClaudeOptionsLike> {
  const effectivePolicy = await resolveEffectivePolicy(
    input.runInput,
    input.runInput.workspace?.cwd ?? input.sessionConfig.cwd
  );
  const compiled = compileProviderPolicy("claude", effectivePolicy);
  const native = nativeConfig(input.sessionConfig.native);
  const runNative = nativeConfig(input.runInput.native);
  const nativeCanUseTool = firstFunction(runNative.canUseTool, native.canUseTool) as
    | ClaudeCanUseTool
    | undefined;

  const options: ClaudeOptionsLike = {
    abortController: input.abortController,
    cwd: input.runInput.workspace?.cwd ?? input.sessionConfig.cwd,
    includeHookEvents: true,
    includePartialMessages: true,
    settingSources: [],
    systemPrompt: {
      preset: "claude_code",
      type: "preset"
    }
  };

  applyCompiledPolicy(options, compiled.nativeConfig);
  applyNativeOptions(options, native);
  applyNativeOptions(options, runNative);

  if (input.sessionConfig.model && !options.model) {
    options.model = input.sessionConfig.model;
  }
  if (input.runInput.model) {
    options.model = input.runInput.model;
  }
  if (input.runInput.limits?.maxTurns) {
    options.maxTurns = input.runInput.limits.maxTurns;
  }
  if (input.runInput.limits?.maxCostUsd) {
    options.maxBudgetUsd = input.runInput.limits.maxCostUsd;
  }
  const resume = input.sessionNativeId ?? input.sessionConfig.nativeSessionId;
  if (resume && !options.resume) {
    options.resume = resume;
  }

  applyApiKeyEnv(options, input.sessionConfig);
  options.canUseTool = createMetaharnessCanUseTool(effectivePolicy, nativeCanUseTool);
  return options;
}

export function buildClaudeBaseOptions(
  config: StartSessionConfig | ResumeSessionConfig
): ClaudeOptionsLike {
  const native = nativeConfig(config.native);
  const options: ClaudeOptionsLike = {
    cwd: config.workspace.cwd,
    includeHookEvents: true,
    includePartialMessages: true,
    settingSources: [],
    systemPrompt: {
      preset: "claude_code",
      type: "preset"
    }
  };
  applyNativeOptions(options, native);
  if (config.model && !options.model) {
    options.model = config.model;
  }
  const apiKeyConfig: Pick<ClaudeSessionConfigSnapshot, "apiKeyEnv" | "auth"> = {};
  if (config.apiKeyEnv) {
    apiKeyConfig.apiKeyEnv = config.apiKeyEnv;
  }
  if (config.auth) {
    apiKeyConfig.auth = config.auth;
  }
  applyApiKeyEnv(options, apiKeyConfig);
  return options;
}

export interface ClaudeSessionConfigSnapshot {
  apiKeyEnv?: string;
  auth?: Record<string, string | undefined>;
  cwd: string;
  model?: string;
  native?: Record<string, unknown>;
  nativeSessionId?: string;
}

export async function resolveEffectivePolicy(
  input: RunInput,
  cwd: string
): Promise<EffectivePolicy> {
  if (!input.policy) {
    return defaultPolicy();
  }

  if (input.policy.file) {
    const path = resolve(cwd, input.policy.file);
    const parsed = await parsePolicyFile(path);
    if (!parsed.policy) {
      throw new ProviderConfigError(
        "claude",
        `Policy file "${path}" is invalid: ${parsed.diagnostics.errors
          .map((error) => error.message)
          .join("; ")}`,
        "CLAUDE_POLICY_INVALID",
        {
          option: "policy.file"
        }
      );
    }
    return parsed.policy;
  }

  if (input.policy.inline) {
    const parsed = validatePolicy(input.policy.inline);
    if (!parsed.policy) {
      throw new ProviderConfigError(
        "claude",
        `Inline policy is invalid: ${parsed.diagnostics.errors
          .map((error) => error.message)
          .join("; ")}`,
        "CLAUDE_POLICY_INVALID",
        {
          option: "policy.inline"
        }
      );
    }
    return parsed.policy;
  }

  return defaultPolicy();
}

function createMetaharnessCanUseTool(
  policy: EffectivePolicy,
  nativeCanUseTool: ClaudeCanUseTool | undefined
): ClaudeCanUseTool {
  return async (toolName, input, options): Promise<ClaudePermissionResult> => {
    if (toolName === "Bash") {
      const command = extractBashCommand(input);
      if (!command) {
        return {
          behavior: "deny",
          message: "Bash command input did not include a command string."
        };
      }
      const decision = checkCommandPolicy(command, policy.commands);
      if (decision.decision !== "allow") {
        const denied: ClaudePermissionResult = {
          behavior: "deny",
          message: decision.reason
        };
        if (options.toolUseID) {
          denied.toolUseID = options.toolUseID;
        }
        return denied;
      }
    }

    if (nativeCanUseTool) {
      return nativeCanUseTool(toolName, input, options);
    }

    const allowed: ClaudePermissionResult = {
      behavior: "allow",
      updatedInput: input
    };
    if (options.toolUseID) {
      allowed.toolUseID = options.toolUseID;
    }
    return allowed;
  };
}

function extractBashCommand(input: Record<string, unknown>): string | undefined {
  for (const key of ["command", "cmd", "script"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function applyCompiledPolicy(
  options: ClaudeOptionsLike,
  nativeConfig: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(nativeConfig)) {
    if (value === undefined || key === "canUseTool") {
      continue;
    }
    setOption(options, key, value);
  }
}

function applyNativeOptions(
  options: ClaudeOptionsLike,
  native: Record<string, unknown>
): void {
  const explicitOptions =
    recordAt(native, "claudeOptions") ??
    recordAt(native, "queryOptions") ??
    recordAt(native, "options");
  for (const key of CLAUDE_PASSTHROUGH_KEYS) {
    if (native[key] !== undefined) {
      setOption(options, key, native[key]);
    }
  }
  if (explicitOptions) {
    for (const [key, value] of Object.entries(explicitOptions)) {
      if (value !== undefined) {
        setOption(options, key, value);
      }
    }
  }
}

function applyApiKeyEnv(
  options: ClaudeOptionsLike,
  config: Pick<ClaudeSessionConfigSnapshot, "apiKeyEnv" | "auth">
): void {
  const apiKeyEnv = config.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const apiKey =
    config.auth?.apiKey ?? config.auth?.[apiKeyEnv] ?? process.env[apiKeyEnv];
  if (!apiKey) {
    return;
  }
  const baseEnv = options.env
    ? { ...options.env }
    : {
        ...stringEnv(process.env)
      };
  baseEnv[apiKeyEnv] = apiKey;
  baseEnv.ANTHROPIC_API_KEY = apiKey;
  baseEnv.CLAUDE_AGENT_SDK_CLIENT_APP ??= "metaharness/0.1.0";
  options.env = baseEnv;
}

function nativeConfig(
  value: Record<string, unknown> | undefined
): Record<string, unknown> {
  const scoped = recordAt(value, "claude");
  return scoped ?? value ?? {};
}

function recordAt(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const candidate = value?.[key];
  if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
    return candidate as Record<string, unknown>;
  }
  return undefined;
}

function setOption(options: ClaudeOptionsLike, key: string, value: unknown): void {
  (options as Record<string, unknown>)[key] = value;
}

function firstFunction(...values: unknown[]): unknown {
  return values.find((value) => typeof value === "function");
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}
