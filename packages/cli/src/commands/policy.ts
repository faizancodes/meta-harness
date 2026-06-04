import { resolve } from "node:path";
import { HarnessError } from "@metaharness/core";
import { compileProviderPolicy, parsePolicyFile } from "@metaharness/policy";
import { parseProviderId } from "../provider-options.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import type { CliIO, GlobalOptions } from "../types.js";
import type { ProviderId } from "@metaharness/core";

export interface PolicyCheckOptions extends GlobalOptions {
  json?: boolean;
  policyFile?: string;
  provider?: ProviderId;
}

export interface PolicyCompileOptions extends GlobalOptions {
  json?: boolean;
  policyFile?: string;
  provider?: ProviderId;
}

export async function policyCheckCommand(
  options: PolicyCheckOptions,
  io: CliIO
): Promise<void> {
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const path = resolve(cwd, options.policyFile ?? "metaharness.policy.yaml");
  const parsed = await parsePolicyFile(path);
  const provider = options.provider ? parseProviderId(options.provider) : undefined;
  const diagnostics = {
    ...parsed.diagnostics,
    providerWarnings:
      parsed.policy && provider
        ? compileProviderPolicy(provider, parsed.policy).warnings
        : parsed.diagnostics.providerWarnings
  };

  if (options.json) {
    io.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
    if (!diagnostics.ok) {
      throwPolicyCheckFailed();
    }
    return;
  }

  io.stdout.write(`policy ${diagnostics.ok ? "ok" : "failed"}\n`);
  for (const error of diagnostics.errors) {
    writeDiagnosticError(io, error);
  }
  for (const warning of [...diagnostics.warnings, ...diagnostics.providerWarnings]) {
    io.stdout.write(`warning ${warning.code}: ${warning.message}\n`);
  }
  if (!diagnostics.ok) {
    throwPolicyCheckFailed();
  }
}

export async function policyCompileCommand(
  options: PolicyCompileOptions,
  io: CliIO
): Promise<void> {
  const provider = parseRequiredProviderId(options.provider);
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const path = resolve(cwd, options.policyFile ?? "metaharness.policy.yaml");
  const parsed = await parsePolicyFile(path);
  if (!parsed.policy) {
    if (options.json) {
      io.stdout.write(`${JSON.stringify(parsed.diagnostics, null, 2)}\n`);
      throwPolicyValidationFailed();
    }
    io.stdout.write("policy failed\n");
    for (const error of parsed.diagnostics.errors) {
      writeDiagnosticError(io, error);
    }
    throwPolicyValidationFailed();
  }

  const compiled = compileProviderPolicy(provider, parsed.policy);
  if (options.json) {
    io.stdout.write(`${JSON.stringify(compiled, null, 2)}\n`);
    return;
  }

  io.stdout.write(`provider ${compiled.provider}\n`);
  io.stdout.write(
    `guards ${compiled.harnessGuards.map((guard) => guard.kind).join(", ") || "none"}\n`
  );
  io.stdout.write(
    `native ${Object.keys(compiled.nativeConfig).sort().join(", ") || "none"}\n`
  );
  for (const warning of compiled.warnings) {
    io.stdout.write(`warning ${warning.code}: ${warning.message}\n`);
  }
}

function parseRequiredProviderId(value: string | undefined): ProviderId {
  if (!value) {
    throw new HarnessError("Missing --provider.", "PROVIDER_MISSING");
  }
  return parseProviderId(value);
}

function writeDiagnosticError(
  io: CliIO,
  error: {
    code: string;
    message: string;
  }
): void {
  io.stderr.write(`error: ${error.code}: ${error.message}\n`);
}

function throwPolicyCheckFailed(): never {
  throw new HarnessError("Policy check failed.", "POLICY_CHECK_FAILED");
}

function throwPolicyValidationFailed(): never {
  throw new HarnessError("Policy validation failed.", "POLICY_VALIDATION_FAILED");
}
