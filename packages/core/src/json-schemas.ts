import * as z from "zod";
import { portableRunEventSchema } from "./event-schema.js";

const providerIdSchema = z.enum(["mock", "claude", "cursor", "codex"]);
const runtimeSchema = z.enum(["local", "cloud", "self-hosted"]);
const runModeSchema = z.enum(["ask", "edit", "review", "plan", "custom"]);
const desiredOutputSchema = z.enum(["message", "patch", "branch", "pull_request"]);
const artifactKindSchema = z.enum([
  "patch",
  "branch",
  "pull_request",
  "file",
  "url",
  "unknown"
]);
const fileChangeKindSchema = z.enum(["create", "modify", "delete", "rename", "unknown"]);

const unknownRecordSchema = z.record(z.string(), z.unknown());
const optionalStringRecordSchema = z.record(z.string(), z.string().optional());

export const workspaceConfigSchema = z
  .object({
    cwd: z.string().min(1),
    git: z
      .object({
        baseRef: z.string().min(1).optional(),
        branchPrefix: z.string().min(1).optional(),
        commitChanges: z.boolean().optional(),
        createWorktree: z.boolean().optional(),
        requireClean: z.boolean().optional(),
        worktreeRoot: z.string().min(1).optional()
      })
      .optional()
  })
  .meta({
    title: "metaharness workspace config"
  });

export const providerConfigSchema = z
  .object({
    apiKeyEnv: z.string().min(1).optional(),
    auth: optionalStringRecordSchema.optional(),
    model: z.string().min(1).optional(),
    native: unknownRecordSchema.optional(),
    provider: providerIdSchema,
    runtime: runtimeSchema.optional()
  })
  .meta({
    title: "metaharness provider config"
  });

export const harnessConfigSchema = z
  .object({
    defaultProvider: providerIdSchema.optional(),
    policy: z
      .object({
        file: z.string().min(1).optional(),
        inline: unknownRecordSchema.optional()
      })
      .optional(),
    providers: z
      .object({
        claude: providerConfigSchema.optional(),
        codex: providerConfigSchema.optional(),
        cursor: providerConfigSchema.optional(),
        mock: providerConfigSchema.optional()
      })
      .optional(),
    rawEvents: z.boolean().optional(),
    storage: z
      .object({
        redactSecrets: z.boolean().optional(),
        rootDir: z.string().min(1).optional()
      })
      .optional(),
    telemetry: z
      .object({
        enabled: z.boolean().optional(),
        exporter: z.enum(["none", "console", "otlp"]).optional(),
        serviceName: z.string().min(1).optional(),
        serviceVersion: z.string().min(1).optional()
      })
      .optional(),
    workspace: workspaceConfigSchema
  })
  .meta({
    title: "metaharness config"
  });

export const sessionLedgerSchema = z
  .object({
    artifacts: z.array(
      z.object({
        kind: artifactKindSchema,
        name: z.string().optional(),
        path: z.string().optional(),
        url: z.string().optional()
      })
    ),
    commands: z.array(
      z.object({
        command: z.string(),
        cwd: z.string().optional(),
        exitCode: z.number().int().optional(),
        outputSummary: z.string().optional(),
        ts: z.string()
      })
    ),
    createdAt: z.string(),
    diff: z.object({
      patchPath: z.string().optional(),
      stats: z
        .object({
          deletions: z.number().int().nonnegative().optional(),
          filesChanged: z.number().int().nonnegative(),
          insertions: z.number().int().nonnegative().optional()
        })
        .optional(),
      unifiedDiff: z.string().optional()
    }),
    events: z.object({
      counts: z.record(z.string(), z.number().int().nonnegative()),
      eventLogPath: z.string(),
      rawEventLogPath: z.string().optional()
    }),
    files: z.object({
      changed: z.array(
        z.object({
          diff: z.string().optional(),
          kind: fileChangeKindSchema,
          path: z.string()
        })
      ),
      read: z.array(z.string())
    }),
    handoffFrom: z
      .object({
        ledgerId: z.string(),
        provider: providerIdSchema,
        runId: z.string()
      })
      .optional(),
    ledgerId: z.string(),
    plans: z.array(
      z.object({
        steps: z.array(
          z.object({
            status: z.string(),
            step: z.string()
          })
        ),
        ts: z.string()
      })
    ),
    provider: z.object({
      id: providerIdSchema,
      model: z.string().optional(),
      nativeRunId: z.string().optional(),
      nativeSessionId: z.string().optional(),
      nativeUrl: z.string().optional(),
      runtime: runtimeSchema.optional()
    }),
    schemaVersion: z.literal("metaharness.session-ledger.v1"),
    summary: z.object({
      facts: z.array(z.string()),
      failureReason: z.string().optional(),
      finalMessage: z.string().optional(),
      nextSteps: z.array(z.string()),
      openQuestions: z.array(z.string())
    }),
    task: z.object({
      desiredOutput: desiredOutputSchema.optional(),
      mode: runModeSchema,
      normalizedPrompt: z.string().optional(),
      originalPrompt: z.string()
    }),
    tools: z.array(
      z.object({
        inputSummary: z.string().optional(),
        kind: z.string(),
        name: z.string(),
        outputSummary: z.string().optional(),
        ts: z.string()
      })
    ),
    transcript: z.array(
      z.object({
        providerEventRef: z.string().optional(),
        role: z.enum(["user", "assistant", "tool", "system"]),
        summary: z.string().optional(),
        text: z.string().optional(),
        ts: z.string()
      })
    ),
    updatedAt: z.string(),
    usage: z
      .object({
        cacheReadTokens: z.number().int().nonnegative().optional(),
        cacheWriteTokens: z.number().int().nonnegative().optional(),
        estimatedCostUsd: z.number().nonnegative().optional(),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        totalTokens: z.number().int().nonnegative().optional()
      })
      .optional(),
    verification: z.array(
      z.object({
        command: z.string(),
        exitCode: z.number().int().optional(),
        outputPath: z.string().optional(),
        summary: z.string().optional()
      })
    ),
    workspace: z.object({
      cwd: z.string(),
      dirtyAfter: z.boolean(),
      dirtyBefore: z.boolean(),
      repo: z
        .object({
          baseRef: z.string().optional(),
          branch: z.string().optional(),
          endingCommit: z.string().optional(),
          headRef: z.string().optional(),
          remoteUrl: z.string().optional(),
          startingCommit: z.string().optional()
        })
        .optional()
    })
  })
  .meta({
    title: "metaharness session ledger"
  });

export function configJsonSchema(): unknown {
  return withSchemaId(
    z.toJSONSchema(harnessConfigSchema, {
      target: "draft-2020-12"
    }),
    "https://metaharness.dev/schemas/metaharness.config.schema.json"
  );
}

export function eventJsonSchema(): unknown {
  return withSchemaId(
    z.toJSONSchema(portableRunEventSchema, {
      target: "draft-2020-12"
    }),
    "https://metaharness.dev/schemas/event.schema.json"
  );
}

export function sessionLedgerJsonSchema(): unknown {
  return withSchemaId(
    z.toJSONSchema(sessionLedgerSchema, {
      target: "draft-2020-12"
    }),
    "https://metaharness.dev/schemas/session-ledger.schema.json"
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
