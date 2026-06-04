import { harnessConfigSchema } from "./json-schemas.js";
import type { ProviderId } from "./types/adapter.js";
import type { HarnessConfig } from "./types/config.js";

export const supportedProviderIds = [
  "mock",
  "claude",
  "cursor",
  "codex"
] as const satisfies readonly ProviderId[];

export const supportedProviderIdList = supportedProviderIds.join(", ");

export interface HarnessConfigValidationSuccess {
  success: true;
  config: HarnessConfig;
}

export interface HarnessConfigValidationFailure {
  success: false;
  reason: "not_object" | "schema";
  diagnostics: string[];
}

export type HarnessConfigValidationResult =
  | HarnessConfigValidationSuccess
  | HarnessConfigValidationFailure;

export function validateHarnessConfig(value: unknown): HarnessConfigValidationResult {
  const diagnostics = configDiagnostics(value);
  if (!isRecord(value)) {
    return {
      success: false,
      reason: "not_object",
      diagnostics
    };
  }

  const parsed = harnessConfigSchema.safeParse(value);
  if (!parsed.success) {
    const coveredPaths = coveredDiagnosticPaths(value);
    diagnostics.push(
      ...parsed.error.issues
        .filter((issue) => !coveredPaths.has(formatIssuePath(issue.path)))
        .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
    );
  }

  if (diagnostics.length > 0) {
    return {
      success: false,
      reason: "schema",
      diagnostics
    };
  }

  return {
    success: true,
    config: parsed.data as HarnessConfig
  };
}

export function isProviderId(value: string): value is ProviderId {
  return (supportedProviderIds as readonly string[]).includes(value);
}

function configDiagnostics(value: unknown): string[] {
  if (!isRecord(value)) {
    return ["config must be an object."];
  }

  const diagnostics: string[] = [];
  const config = value as Partial<HarnessConfig> & {
    providers?: unknown;
  };
  if (
    typeof config.defaultProvider === "string" &&
    !isProviderId(config.defaultProvider)
  ) {
    diagnostics.push(
      `Unsupported defaultProvider "${config.defaultProvider}". Supported providers: ${supportedProviderIdList}.`
    );
  }

  if (config.providers !== undefined) {
    if (!isRecord(config.providers)) {
      diagnostics.push("providers must be an object keyed by provider id.");
    } else {
      for (const [key, providerConfig] of Object.entries(config.providers)) {
        if (!isProviderId(key)) {
          diagnostics.push(
            `providers.${key} is not supported. Supported providers: ${supportedProviderIdList}.`
          );
          continue;
        }
        if (isRecord(providerConfig)) {
          const configuredProvider = providerConfig.provider;
          if (
            typeof configuredProvider === "string" &&
            isProviderId(configuredProvider) &&
            configuredProvider !== key
          ) {
            diagnostics.push(
              `providers.${key}.provider must be "${key}", got "${configuredProvider}".`
            );
          }
        }
      }
    }
  }

  return diagnostics;
}

function coveredDiagnosticPaths(value: object): Set<string> {
  const coveredPaths = new Set<string>();
  const config = value as Partial<HarnessConfig> & {
    providers?: unknown;
  };

  if (
    typeof config.defaultProvider === "string" &&
    !isProviderId(config.defaultProvider)
  ) {
    coveredPaths.add("defaultProvider");
  }

  if (config.providers !== undefined && !isRecord(config.providers)) {
    coveredPaths.add("providers");
  }

  return coveredPaths;
}

function formatIssuePath(path: readonly PropertyKey[]): string {
  return path.length > 0 ? path.map(String).join(".") : "config";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
