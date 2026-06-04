import { z } from "zod";
import { EventValidationError } from "./errors.js";
import type { PortableRunEvent, PortableRunEventType } from "./types/events.js";

const providerIdSchema = z.enum(["mock", "claude", "cursor", "codex"]);
const runModeSchema = z.enum(["ask", "edit", "review", "plan", "custom"]);
const eventSeveritySchema = z.enum(["debug", "info", "warn", "error"]);
const planStepStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
  "failed"
]);
const toolKindSchema = z.enum([
  "mcp",
  "built_in",
  "dynamic",
  "provider_native",
  "unknown"
]);
const commandOutputStreamSchema = z.enum(["stdout", "stderr", "combined", "unknown"]);
const fileChangeKindSchema = z.enum(["create", "modify", "delete", "rename", "unknown"]);
const fileChangeStatusSchema = z.enum(["completed", "failed", "declined"]);
const approvalCategorySchema = z.enum([
  "command",
  "file_change",
  "network",
  "mcp_tool",
  "provider_native",
  "unknown"
]);
const approvalDecisionSchema = z.enum([
  "accept",
  "accept_for_session",
  "decline",
  "cancel"
]);
const runStatusSchema = z.enum([
  "queued",
  "starting",
  "running",
  "waiting_for_approval",
  "cancelling",
  "completed",
  "failed",
  "cancelled"
]);
const runResultStatusSchema = z.enum(["success", "failed", "cancelled"]);
const artifactKindSchema = z.enum([
  "patch",
  "branch",
  "pull_request",
  "file",
  "screenshot",
  "url",
  "unknown"
]);
const messagePhaseSchema = z.enum(["commentary", "final", "unknown"]);

const isoStringSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected an ISO-like date string"
  });

const baseEventFields = {
  id: z.string().min(1),
  ts: isoStringSchema,
  provider: providerIdSchema,
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  seq: z.number().int().positive(),
  severity: eventSeveritySchema.optional()
} as const;

const normalizedErrorSchema = z
  .object({
    message: z.string(),
    code: z.string().optional(),
    providerCode: z.string().optional(),
    retryable: z.boolean().optional(),
    cause: z.unknown().optional()
  })
  .passthrough();

const toolIdentitySchema = z
  .object({
    name: z.string().min(1),
    kind: toolKindSchema,
    server: z.string().optional()
  })
  .passthrough();

const usageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative().optional(),
    estimatedCostUsd: z.number().nonnegative().optional()
  })
  .passthrough();

const artifactSchema = z
  .object({
    kind: artifactKindSchema,
    name: z.string().optional(),
    path: z.string().optional(),
    url: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .passthrough();

const runResultPartialSchema = z
  .object({
    provider: providerIdSchema.optional(),
    runId: z.string().optional(),
    sessionId: z.string().optional(),
    nativeRunId: z.string().optional(),
    nativeSessionId: z.string().optional(),
    status: runResultStatusSchema.optional(),
    finalMessage: z.string().optional(),
    diff: z.string().optional(),
    patchPath: z.string().optional(),
    ledgerPath: z.string().optional(),
    handoffPath: z.string().optional(),
    eventLogPath: z.string().optional(),
    verificationLogPath: z.string().optional(),
    artifacts: z.array(artifactSchema).optional(),
    usage: usageSchema.optional(),
    providerRunUrl: z.string().optional(),
    native: z.unknown().optional()
  })
  .passthrough();

function portableEventSchema<TType extends PortableRunEventType>(
  type: TType,
  payload: z.ZodRawShape
) {
  return z
    .object({
      ...baseEventFields,
      type: z.literal(type),
      ...payload
    })
    .passthrough();
}

export const portableRunEventSchema = z.discriminatedUnion("type", [
  portableEventSchema("run.started", {
    input: z
      .object({
        taskHash: z.string().min(1),
        mode: runModeSchema,
        cwd: z.string().optional()
      })
      .passthrough()
  }),
  portableEventSchema("run.status", {
    status: runStatusSchema,
    message: z.string().optional()
  }),
  portableEventSchema("assistant.message.delta", {
    text: z.string(),
    phase: messagePhaseSchema.optional()
  }),
  portableEventSchema("assistant.message.completed", {
    text: z.string(),
    phase: messagePhaseSchema.optional()
  }),
  portableEventSchema("plan.updated", {
    explanation: z.string().optional(),
    steps: z.array(
      z
        .object({
          step: z.string(),
          status: planStepStatusSchema
        })
        .passthrough()
    )
  }),
  portableEventSchema("tool.started", {
    tool: toolIdentitySchema,
    input: z.unknown().optional()
  }),
  portableEventSchema("tool.delta", {
    toolCallId: z.string().optional(),
    text: z.string().optional(),
    data: z.unknown().optional()
  }),
  portableEventSchema("tool.finished", {
    tool: toolIdentitySchema,
    output: z.unknown().optional(),
    error: normalizedErrorSchema.optional()
  }),
  portableEventSchema("command.started", {
    command: z.string(),
    cwd: z.string().optional(),
    reason: z.string().optional()
  }),
  portableEventSchema("command.output.delta", {
    commandId: z.string().optional(),
    stream: commandOutputStreamSchema,
    text: z.string()
  }),
  portableEventSchema("command.finished", {
    command: z.string(),
    cwd: z.string().optional(),
    exitCode: z.number().int().optional(),
    durationMs: z.number().nonnegative().optional(),
    outputSummary: z.string().optional(),
    error: normalizedErrorSchema.optional()
  }),
  portableEventSchema("file.change.started", {
    path: z.string(),
    changeKind: fileChangeKindSchema
  }),
  portableEventSchema("file.change.updated", {
    path: z.string(),
    diff: z.string().optional()
  }),
  portableEventSchema("file.change.finished", {
    path: z.string(),
    changeKind: fileChangeKindSchema,
    diff: z.string().optional(),
    status: fileChangeStatusSchema
  }),
  portableEventSchema("diff.updated", {
    unifiedDiff: z.string()
  }),
  portableEventSchema("approval.requested", {
    approvalId: z.string(),
    category: approvalCategorySchema,
    reason: z.string().optional(),
    preview: z
      .object({
        command: z.string().optional(),
        cwd: z.string().optional(),
        path: z.string().optional(),
        diff: z.string().optional(),
        host: z.string().optional(),
        protocol: z.string().optional()
      })
      .passthrough()
      .optional(),
    availableDecisions: z.array(approvalDecisionSchema),
    native: z.unknown().optional()
  }),
  portableEventSchema("approval.resolved", {
    approvalId: z.string(),
    decision: approvalDecisionSchema
  }),
  portableEventSchema("usage.updated", {
    usage: usageSchema
  }),
  portableEventSchema("artifact.created", {
    artifact: artifactSchema
  }),
  portableEventSchema("error", {
    error: normalizedErrorSchema
  }),
  portableEventSchema("run.completed", {
    status: runResultStatusSchema,
    finalMessage: z.string().optional(),
    result: runResultPartialSchema.optional()
  }),
  portableEventSchema("provider.raw", {
    providerEventType: z.string().optional(),
    raw: z.unknown()
  })
]);

export function parsePortableRunEvent(value: unknown): PortableRunEvent {
  const parsed = portableRunEventSchema.safeParse(value);
  if (!parsed.success) {
    throw new EventValidationError(z.prettifyError(parsed.error));
  }
  return parsed.data as PortableRunEvent;
}
