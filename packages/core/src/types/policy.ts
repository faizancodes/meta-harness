import type { ProviderId } from "./adapter.js";

export interface HarnessPolicyConfig {
  file?: string;
  inline?: Record<string, unknown>;
}

export interface PolicyCheckInput extends HarnessPolicyConfig {
  cwd?: string;
  provider?: ProviderId;
}

export interface HarnessPolicyApi {
  check(input?: PolicyCheckInput): Promise<PolicyCheckResult>;
}

export interface PolicyDiagnostic {
  code: string;
  message: string;
  path?: string;
  provider?: ProviderId;
}

export interface PolicyCheckResult {
  ok: boolean;
  errors: PolicyDiagnostic[];
  warnings: PolicyDiagnostic[];
  providerWarnings: PolicyDiagnostic[];
}
