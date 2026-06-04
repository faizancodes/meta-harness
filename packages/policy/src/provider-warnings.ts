import type { ProviderId, PolicyDiagnostic } from "@metaharness/core";
import type { EffectivePolicy } from "./schema.js";

export function providerWarnings(
  provider: ProviderId,
  policy: EffectivePolicy
): PolicyDiagnostic[] {
  const warnings = [];
  if (provider === "mock") {
    warnings.push({
      code: "PROVIDER_POLICY_MOCK_SYNTHETIC",
      message: "Mock adapter does not enforce provider-native policy controls.",
      provider
    });
    return warnings;
  }

  if (provider === "cursor") {
    warnings.push({
      code: "PROVIDER_POLICY_CURSOR_BETA",
      message:
        "Cursor SDK policy support is runtime-dependent; metaharness must keep harness-level diff and duration guards.",
      provider
    });
    if (policy.commands.allow.length > 0 || policy.commands.deny.length > 0) {
      warnings.push({
        code: "PROVIDER_POLICY_CURSOR_COMMAND_GUARD",
        message:
          "Cursor command allow/deny controls may not be fully native in every runtime; enforce observable limits at the harness layer.",
        provider,
        path: "commands"
      });
    }
  }

  if (provider === "codex" && policy.filesystem.mode === "full-access") {
    warnings.push({
      code: "PROVIDER_POLICY_CODEX_FULL_ACCESS",
      message: "Codex full-access sandbox should require explicit human approval.",
      provider,
      path: "filesystem.mode"
    });
  }

  if (provider === "claude" && policy.network.mode !== "provider-default") {
    warnings.push({
      code: "PROVIDER_POLICY_CLAUDE_NETWORK_LIMITS",
      message:
        "Claude network policy enforcement depends on provider-native sandbox and permissions; metaharness will still redact and audit events.",
      provider,
      path: "network.mode"
    });
  }

  return warnings;
}
