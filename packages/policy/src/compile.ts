import { checkCommandPolicy } from "./command-policy.js";
import { providerWarnings } from "./provider-warnings.js";
import type { CommandPolicyResult } from "./command-policy.js";
import type { EffectivePolicy } from "./schema.js";
import type { PolicyDiagnostic, ProviderId } from "@metaharness/core";

export type HarnessGuard =
  | {
      kind: "command-policy";
    }
  | {
      kind: "diff-limit";
      maxDiffBytes?: number;
      maxFilesChanged?: number;
    }
  | {
      kind: "duration-limit";
      maxDurationMs: number;
    }
  | {
      kind: "cost-limit";
      maxCostUsd: number;
    }
  | {
      kind: "approval-required";
      reasons: string[];
    };

export interface CompiledProviderPolicy {
  provider: ProviderId;
  nativeConfig: Record<string, unknown>;
  harnessGuards: HarnessGuard[];
  warnings: PolicyDiagnostic[];
}

export function compileProviderPolicy(
  provider: ProviderId,
  policy: EffectivePolicy
): CompiledProviderPolicy {
  const base = {
    harnessGuards: compileHarnessGuards(policy),
    provider,
    warnings: providerWarnings(provider, policy)
  };

  switch (provider) {
    case "claude":
      return {
        ...base,
        nativeConfig: compileClaudeNativePolicy(policy)
      };
    case "cursor":
      return {
        ...base,
        nativeConfig: compileCursorNativePolicy(policy)
      };
    case "codex":
      return {
        ...base,
        nativeConfig: compileCodexNativePolicy(policy)
      };
    case "mock":
      return {
        ...base,
        nativeConfig: {}
      };
  }
}

export function compileHarnessGuards(policy: EffectivePolicy): HarnessGuard[] {
  const guards: HarnessGuard[] = [
    {
      kind: "command-policy"
    }
  ];
  if (policy.limits.maxDiffBytes || policy.limits.maxFilesChanged) {
    const guard: HarnessGuard = {
      kind: "diff-limit"
    };
    if (policy.limits.maxDiffBytes) {
      guard.maxDiffBytes = policy.limits.maxDiffBytes;
    }
    if (policy.limits.maxFilesChanged) {
      guard.maxFilesChanged = policy.limits.maxFilesChanged;
    }
    guards.push(guard);
  }
  if (policy.limits.maxDurationMs) {
    guards.push({
      kind: "duration-limit",
      maxDurationMs: policy.limits.maxDurationMs
    });
  }
  if (policy.limits.maxCostUsd) {
    guards.push({
      kind: "cost-limit",
      maxCostUsd: policy.limits.maxCostUsd
    });
  }
  if (policy.approvals.requireHumanFor.length > 0) {
    guards.push({
      kind: "approval-required",
      reasons: policy.approvals.requireHumanFor
    });
  }
  return guards;
}

export function evaluateCompiledCommandPolicy(
  policy: EffectivePolicy,
  command: string
): CommandPolicyResult {
  return checkCommandPolicy(command, policy.commands);
}

function compileClaudeNativePolicy(policy: EffectivePolicy): Record<string, unknown> {
  const defaultDisallowedTools = ["PrintEnv", "SecretRead"];
  const native: Record<string, unknown> = {
    canUseTool: "metaharness.command-policy",
    disallowedTools: defaultDisallowedTools,
    maxBudgetUsd: policy.limits.maxCostUsd,
    maxTurns: policy.limits.maxTurns,
    settingSources: []
  };

  if (policy.filesystem.mode === "read-only") {
    native.allowedTools = ["Read", "Glob", "Grep", "LS"];
    native.disallowedTools = [
      ...defaultDisallowedTools,
      "Edit",
      "Write",
      "NotebookEdit",
      "Bash"
    ];
  } else if (policy.filesystem.mode === "workspace-write") {
    native.permissionMode = "default";
    native.allowedTools = ["Read", "Glob", "Grep", "LS", "Edit", "Write", "Bash"];
  } else {
    native.permissionMode = "acceptEdits";
    native.allowedTools = ["Read", "Glob", "Grep", "LS", "Edit", "Write", "Bash"];
  }

  return mergeProviderOverride(native, policy.providerOverrides.claude);
}

function compileCursorNativePolicy(policy: EffectivePolicy): Record<string, unknown> {
  const override = policy.providerOverrides.cursor;
  const native: Record<string, unknown> = {
    local: {
      filesystemMode: policy.filesystem.mode
    },
    runtime: override?.runtime ?? "local"
  };
  if (policy.network.allowHosts.length > 0) {
    native.networkAllowHosts = policy.network.allowHosts;
  }
  return mergeProviderOverride(native, override);
}

function compileCodexNativePolicy(policy: EffectivePolicy): Record<string, unknown> {
  const native: Record<string, unknown> = {
    approvalPolicy: policy.approvals.requireHumanFor,
    sandbox: mapCodexSandbox(policy.filesystem.mode)
  };
  if (policy.limits.maxTurns) {
    native.maxTurns = policy.limits.maxTurns;
  }
  return mergeProviderOverride(native, policy.providerOverrides.codex);
}

function mapCodexSandbox(mode: EffectivePolicy["filesystem"]["mode"]): string {
  switch (mode) {
    case "read-only":
      return "read-only";
    case "workspace-write":
      return "workspace-write";
    case "full-access":
      return "full-access";
  }
}

function mergeProviderOverride(
  native: Record<string, unknown>,
  override: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...native,
    ...(override ?? {})
  };
}
