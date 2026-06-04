import type {
  CursorAgentOptionsLike,
  CursorCloudOptionsLike,
  CursorModelSelectionLike,
  CursorRuntime,
  CursorSendOptionsLike
} from "./types.js";
import type { RunInput, StartSessionConfig } from "@metaharness/core";

const AGENT_OPTION_KEYS = [
  "agentId",
  "agents",
  "cloud",
  "idempotencyKey",
  "local",
  "mcpServers",
  "mode",
  "model",
  "name"
] as const;

const SEND_OPTION_KEYS = [
  "idempotencyKey",
  "local",
  "mcpServers",
  "mode",
  "model"
] as const;

export function buildCursorAgentOptions(
  config: StartSessionConfig
): CursorAgentOptionsLike {
  const runtime = resolveCursorRuntime(config);
  const native = nativeConfig(config.native);
  const explicitOptions =
    recordAt(native, "agentOptions") ?? recordAt(native, "cursorOptions");
  const options: CursorAgentOptionsLike = {};
  applyKnownOptions(options, native, AGENT_OPTION_KEYS);
  applyKnownOptions(options, explicitOptions, AGENT_OPTION_KEYS);

  const apiKey = resolveApiKey(config);
  if (apiKey && !options.apiKey) {
    options.apiKey = apiKey;
  }
  if (!options.model && config.model) {
    options.model = mapModel(config.model);
  }
  if (!options.model && runtime === "local") {
    options.model = mapModel("composer-2");
  }

  if (runtime === "cloud") {
    options.cloud = {
      ...buildCloudOptions(native),
      ...(options.cloud ?? {})
    };
    delete options.local;
  } else {
    options.local = {
      cwd: config.workspace.cwd,
      settingSources: [],
      ...(options.local ?? {}),
      ...buildLocalOptions(native)
    };
    delete options.cloud;
  }

  return options;
}

export function buildCursorSendOptions(input: RunInput): CursorSendOptionsLike {
  const native = nativeConfig(input.native);
  const explicitOptions = recordAt(native, "sendOptions");
  const options: CursorSendOptionsLike = {};
  applyKnownOptions(options, native, SEND_OPTION_KEYS);
  applyKnownOptions(options, explicitOptions, SEND_OPTION_KEYS);

  if (input.model) {
    options.model = mapModel(input.model);
  }
  if (input.mode === "plan" && !options.mode) {
    options.mode = "plan";
  }
  return options;
}

export function resolveCursorRuntime(config: StartSessionConfig): CursorRuntime {
  const native = nativeConfig(config.native);
  const runtime = native.runtime ?? config.runtime;
  if (runtime === "cloud" || runtime === "self-hosted") {
    return runtime;
  }
  return "local";
}

export function mapModel(
  model: string | CursorModelSelectionLike
): CursorModelSelectionLike {
  if (typeof model === "string") {
    return {
      id: model
    };
  }
  return model;
}

function resolveApiKey(config: StartSessionConfig): string | undefined {
  const apiKeyEnv = config.apiKeyEnv ?? "CURSOR_API_KEY";
  return config.auth?.apiKey ?? config.auth?.[apiKeyEnv] ?? process.env[apiKeyEnv];
}

function buildLocalOptions(
  native: Record<string, unknown>
): NonNullable<CursorAgentOptionsLike["local"]> {
  const local = recordAt(native, "local");
  const output: NonNullable<CursorAgentOptionsLike["local"]> = {};
  if (local) {
    if (typeof local.cwd === "string" || isStringArray(local.cwd)) {
      output.cwd = local.cwd;
    }
    if (isStringArray(local.settingSources)) {
      output.settingSources = local.settingSources;
    }
    if (
      isRecord(local.sandboxOptions) &&
      typeof local.sandboxOptions.enabled === "boolean"
    ) {
      output.sandboxOptions = {
        enabled: local.sandboxOptions.enabled
      };
    }
    if ("store" in local) {
      output.store = local.store;
    }
  }
  return output;
}

function buildCloudOptions(native: Record<string, unknown>): CursorCloudOptionsLike {
  const cloud = recordAt(native, "cloud");
  const output: CursorCloudOptionsLike = {};
  if (!cloud) {
    return output;
  }
  if (Array.isArray(cloud.repos)) {
    output.repos = cloud.repos.filter(isRecord).flatMap((repo) => {
      if (typeof repo.url !== "string") {
        return [];
      }
      return [
        {
          ...(typeof repo.prUrl === "string" ? { prUrl: repo.prUrl } : {}),
          ...(typeof repo.startingRef === "string"
            ? { startingRef: repo.startingRef }
            : {}),
          url: repo.url
        }
      ];
    });
  }
  if (typeof cloud.autoCreatePR === "boolean") {
    output.autoCreatePR = cloud.autoCreatePR;
  }
  if (typeof cloud.skipReviewerRequest === "boolean") {
    output.skipReviewerRequest = cloud.skipReviewerRequest;
  }
  if (typeof cloud.workOnCurrentBranch === "boolean") {
    output.workOnCurrentBranch = cloud.workOnCurrentBranch;
  }
  if (isStringRecord(cloud.envVars)) {
    output.envVars = cloud.envVars;
  }
  if (isRecord(cloud.env) && isCursorCloudEnvType(cloud.env.type)) {
    output.env = {
      ...(typeof cloud.env.name === "string" ? { name: cloud.env.name } : {}),
      type: cloud.env.type
    };
  }
  return output;
}

function nativeConfig(
  value: Record<string, unknown> | undefined
): Record<string, unknown> {
  const scoped = recordAt(value, "cursor");
  return scoped ?? value ?? {};
}

function recordAt(
  value: Record<string, unknown> | undefined,
  key: string
): Record<string, unknown> | undefined {
  const candidate = value?.[key];
  return isRecord(candidate) ? candidate : undefined;
}

function applyKnownOptions<TKey extends readonly string[]>(
  output: Record<string, unknown>,
  input: Record<string, unknown> | undefined,
  keys: TKey
): void {
  if (!input) {
    return;
  }
  for (const key of keys) {
    if (input[key] !== undefined) {
      output[key] = input[key];
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) && Object.values(value).every((item) => typeof item === "string")
  );
}

function isCursorCloudEnvType(value: unknown): value is "cloud" | "pool" | "machine" {
  return value === "cloud" || value === "pool" || value === "machine";
}
