import type { ProviderConfig } from "./config.js";
import type { ProviderId } from "./adapter.js";
import type { SessionLedger } from "./ledger.js";
import type { WorkspaceConfig } from "./workspace.js";

export interface StartSessionConfig {
  provider: ProviderId;
  workspace: WorkspaceConfig;
  model?: string;
  runtime?: "local" | "cloud" | "self-hosted";
  apiKeyEnv?: string;
  auth?: Record<string, string | undefined>;
  native?: Record<string, unknown>;
  providerConfig?: ProviderConfig;
}

export interface ResumeSessionConfig extends StartSessionConfig {
  sessionId?: string;
  nativeSessionId?: string;
  ledger?: SessionLedger;
}

export interface SessionHandle<TNative = unknown> {
  provider: ProviderId;
  sessionId: string;
  nativeSessionId?: string;
  native: TNative;
  createdAt: string;
  cwd?: string;
}
