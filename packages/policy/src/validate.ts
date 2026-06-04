import * as z from "zod";
import { metaharnessPolicySchema } from "./schema.js";
import type { EffectivePolicy } from "./schema.js";
import type { PolicyCheckResult } from "@metaharness/core";

export interface ValidatePolicyResult {
  policy?: EffectivePolicy;
  diagnostics: PolicyCheckResult;
}

export function validatePolicy(value: unknown): ValidatePolicyResult {
  const result = metaharnessPolicySchema.safeParse(value);
  if (!result.success) {
    return {
      diagnostics: {
        errors: result.error.issues.map((issue) => ({
          code: "POLICY_SCHEMA_ERROR",
          message: issue.message,
          path: issue.path.map(String).join(".")
        })),
        ok: false,
        providerWarnings: [],
        warnings: []
      }
    };
  }

  return {
    diagnostics: checkPolicy(result.data),
    policy: result.data
  };
}

export function checkPolicy(policy: EffectivePolicy): PolicyCheckResult {
  const warnings = [];
  if (policy.filesystem.mode === "full-access") {
    warnings.push({
      code: "POLICY_FULL_ACCESS",
      message:
        "filesystem.mode full-access allows unrestricted writes and should be avoided in CI.",
      path: "filesystem.mode"
    });
  }
  if (policy.network.mode === "allow") {
    warnings.push({
      code: "POLICY_NETWORK_ALLOW",
      message: "network.mode allow disables host allow-list enforcement.",
      path: "network.mode"
    });
  }
  if (policy.commands.default === "allow") {
    warnings.push({
      code: "POLICY_COMMAND_DEFAULT_ALLOW",
      message: "commands.default allow runs commands unless explicitly denied.",
      path: "commands.default"
    });
  }

  return {
    errors: [],
    ok: true,
    providerWarnings: [],
    warnings
  };
}

export function formatPolicySchemaError(error: z.ZodError): string {
  return z.prettifyError(error);
}
