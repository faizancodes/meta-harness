import { redactValue } from "@metaharness/core";
import type { SecretsPolicy } from "./schema.js";

export function compileRedactionPatterns(policy: SecretsPolicy): RegExp[] {
  return policy.redactPatterns.map((pattern) => new RegExp(pattern, "g"));
}

export function redactWithPolicy(value: unknown, policy: SecretsPolicy): unknown {
  const env = Object.fromEntries(
    policy.redactEnv.map((name) => [name, process.env[name]] as const)
  ) as NodeJS.ProcessEnv;
  return redactValue(value, {
    env,
    patterns: compileRedactionPatterns(policy)
  });
}
