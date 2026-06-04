import { readFile } from "node:fs/promises";
import { spanAttributes, withHarnessSpanSync } from "@metaharness/core";
import { parseDocument } from "yaml";
import { validatePolicy } from "./validate.js";
import type { EffectivePolicy } from "./schema.js";
import type { HarnessSpan } from "@metaharness/core";
import type { PolicyCheckResult } from "@metaharness/core";

export interface ParsePolicyResult {
  policy?: EffectivePolicy;
  diagnostics: PolicyCheckResult;
}

export function parsePolicyYaml(source: string): ParsePolicyResult {
  return withHarnessSpanSync(
    "policy.check",
    spanAttributes({
      "policy.source": "yaml"
    }),
    (span) => {
      const document = parseDocument(source);
      if (document.errors.length > 0) {
        const result: ParsePolicyResult = {
          diagnostics: {
            errors: document.errors.map((error) => ({
              code: "POLICY_YAML_PARSE_ERROR",
              message: error.message
            })),
            ok: false,
            providerWarnings: [],
            warnings: document.warnings.map((warning) => ({
              code: "POLICY_YAML_WARNING",
              message: warning.message
            }))
          }
        };
        recordPolicyDiagnostics(span, result);
        return result;
      }

      const parsed = validatePolicy(document.toJS());
      if (!parsed.policy) {
        const result: ParsePolicyResult = {
          diagnostics: parsed.diagnostics
        };
        recordPolicyDiagnostics(span, result);
        return result;
      }
      const result: ParsePolicyResult = {
        diagnostics: parsed.diagnostics,
        policy: parsed.policy
      };
      recordPolicyDiagnostics(span, result);
      return result;
    }
  );
}

export async function parsePolicyFile(path: string): Promise<ParsePolicyResult> {
  try {
    return parsePolicyYaml(await readFile(path, "utf8"));
  } catch (error) {
    const notFound = isNodeError(error) && error.code === "ENOENT";
    return {
      diagnostics: {
        errors: [
          {
            code: notFound ? "POLICY_FILE_NOT_FOUND" : "POLICY_FILE_READ_ERROR",
            message: notFound
              ? `Policy file "${path}" was not found.`
              : `Policy file "${path}" could not be read: ${formatError(error)}`,
            path
          }
        ],
        ok: false,
        providerWarnings: [],
        warnings: []
      }
    };
  }
}

function recordPolicyDiagnostics(span: HarnessSpan, result: ParsePolicyResult): void {
  span.setAttributes(
    spanAttributes({
      "harness.status": result.diagnostics.ok ? "success" : "failed",
      "policy.error_count": result.diagnostics.errors.length,
      "policy.provider_warning_count": result.diagnostics.providerWarnings.length,
      "policy.warning_count": result.diagnostics.warnings.length
    })
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
