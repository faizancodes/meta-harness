import * as z from "zod";

export const filesystemModeSchema = z.enum([
  "read-only",
  "workspace-write",
  "full-access"
]);
export const networkModeSchema = z.enum(["allow", "deny-by-default", "provider-default"]);
export const commandDefaultSchema = z.enum(["allow", "deny"]);
export const approvalReasonSchema = z.enum([
  "outsideWorkspaceWrite",
  "destructiveCommand",
  "network",
  "secretsAccess"
]);
export const providerIdSchema = z.enum(["mock", "claude", "cursor", "codex"]);

const nonEmptyStringArray = z.array(z.string().min(1)).default([]);
const providerOverrideObjectSchema = z.record(z.string(), z.unknown());

export const filesystemPolicySchema = z
  .strictObject({
    mode: filesystemModeSchema.default("workspace-write"),
    writableRoots: nonEmptyStringArray.default(["."]),
    deny: nonEmptyStringArray.default([
      ".env",
      ".env.local",
      ".env.*.local",
      ".env.development",
      ".env.production",
      ".env.test",
      ".env.staging",
      "**/id_rsa",
      "**/.aws/**",
      "**/.ssh/**",
      "**/node_modules/**"
    ])
  })
  .default({
    deny: [
      ".env",
      ".env.local",
      ".env.*.local",
      ".env.development",
      ".env.production",
      ".env.test",
      ".env.staging",
      "**/id_rsa",
      "**/.aws/**",
      "**/.ssh/**",
      "**/node_modules/**"
    ],
    mode: "workspace-write",
    writableRoots: ["."]
  });

export const networkPolicySchema = z
  .strictObject({
    mode: networkModeSchema.default("deny-by-default"),
    allowHosts: nonEmptyStringArray.default([])
  })
  .default({
    allowHosts: [],
    mode: "deny-by-default"
  });

export const commandPolicySchema = z
  .strictObject({
    default: commandDefaultSchema.default("deny"),
    allow: nonEmptyStringArray.default([]),
    deny: nonEmptyStringArray.default([
      "rm -rf *",
      "curl * | sh",
      "wget * | sh",
      "gh secret *",
      "aws secretsmanager *",
      "printenv",
      "env"
    ])
  })
  .default({
    allow: [],
    default: "deny",
    deny: [
      "rm -rf *",
      "curl * | sh",
      "wget * | sh",
      "gh secret *",
      "aws secretsmanager *",
      "printenv",
      "env"
    ]
  });

export const approvalPolicySchema = z
  .strictObject({
    requireHumanFor: z.array(approvalReasonSchema).default([])
  })
  .default({
    requireHumanFor: []
  });

export const secretsPolicySchema = z
  .strictObject({
    redactEnv: nonEmptyStringArray.default([
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "CURSOR_API_KEY",
      "GITHUB_TOKEN"
    ]),
    redactPatterns: nonEmptyStringArray.default([
      "sk-[A-Za-z0-9_-]{20,}",
      "ghp_[A-Za-z0-9_]{20,}"
    ])
  })
  .default({
    redactEnv: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CURSOR_API_KEY", "GITHUB_TOKEN"],
    redactPatterns: ["sk-[A-Za-z0-9_-]{20,}", "ghp_[A-Za-z0-9_]{20,}"]
  });

export const limitPolicySchema = z
  .strictObject({
    maxTurns: z.number().int().positive().optional(),
    maxDurationMs: z.number().int().positive().optional(),
    maxCostUsd: z.number().positive().optional(),
    maxFilesChanged: z.number().int().positive().optional(),
    maxDiffBytes: z.number().int().positive().optional()
  })
  .default({});

export const providerOverridesSchema = z
  .strictObject({
    claude: providerOverrideObjectSchema.optional(),
    codex: providerOverrideObjectSchema.optional(),
    cursor: providerOverrideObjectSchema.optional(),
    mock: providerOverrideObjectSchema.optional()
  })
  .default({});

export const metaharnessPolicySchema = z
  .strictObject({
    version: z.literal(1),
    filesystem: filesystemPolicySchema,
    network: networkPolicySchema,
    commands: commandPolicySchema,
    approvals: approvalPolicySchema,
    secrets: secretsPolicySchema,
    limits: limitPolicySchema,
    providerOverrides: providerOverridesSchema
  })
  .meta({
    title: "metaharness policy"
  });

export type FilesystemMode = z.infer<typeof filesystemModeSchema>;
export type NetworkMode = z.infer<typeof networkModeSchema>;
export type CommandDefault = z.infer<typeof commandDefaultSchema>;
export type ApprovalReason = z.infer<typeof approvalReasonSchema>;
export type FilesystemPolicy = z.infer<typeof filesystemPolicySchema>;
export type NetworkPolicy = z.infer<typeof networkPolicySchema>;
export type CommandPolicy = z.infer<typeof commandPolicySchema>;
export type ApprovalPolicy = z.infer<typeof approvalPolicySchema>;
export type SecretsPolicy = z.infer<typeof secretsPolicySchema>;
export type LimitPolicy = z.infer<typeof limitPolicySchema>;
export type EffectivePolicy = z.infer<typeof metaharnessPolicySchema>;

export function defaultPolicy(): EffectivePolicy {
  return metaharnessPolicySchema.parse({
    version: 1
  });
}

export function policyJsonSchema(): unknown {
  return withSchemaId(
    z.toJSONSchema(metaharnessPolicySchema, {
      target: "draft-2020-12"
    }),
    "https://metaharness.dev/schemas/metaharness.policy.schema.json"
  );
}

function withSchemaId(schema: unknown, id: string): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }
  return {
    $id: id,
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...schema
  };
}
