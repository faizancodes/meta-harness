import type { ProviderId } from "./adapter.js";
import type { HarnessPolicyConfig } from "./policy.js";
import type { TelemetryConfig } from "./telemetry.js";
import type { WorkspaceConfig } from "./workspace.js";

export interface HarnessConfig {
  workspace: WorkspaceConfig;
  providers?: Partial<Record<ProviderId, ProviderConfig>>;
  defaultProvider?: ProviderId;
  policy?: HarnessPolicyConfig;
  telemetry?: TelemetryConfig;
  storage?: StorageConfig;
  rawEvents?: boolean;
}

export interface ProviderConfig {
  provider: ProviderId;
  model?: string;
  runtime?: "local" | "cloud" | "self-hosted";
  apiKeyEnv?: string;
  auth?: Record<string, string | undefined>;
  native?: Record<string, unknown>;
}

export interface StorageConfig {
  rootDir?: string;
  redactSecrets?: boolean;
}

export type { TelemetryConfig, WorkspaceConfig };
