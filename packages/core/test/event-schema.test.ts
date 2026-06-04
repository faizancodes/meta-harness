import { describe, expect, it } from "vitest";
import {
  configJsonSchema,
  eventJsonSchema,
  parsePortableRunEvent,
  portableRunEventTypes,
  sessionLedgerJsonSchema
} from "../src/index.js";
import type { PortableRunEventType } from "../src/index.js";

describe("portable event schema", () => {
  it("accepts all declared event type names with required portable payloads", () => {
    for (const type of portableRunEventTypes) {
      expect(parsePortableRunEvent(eventForType(type)).type).toBe(type);
    }
  });

  it("rejects malformed base events", () => {
    expect(() =>
      parsePortableRunEvent({
        provider: "mock",
        type: "run.started"
      })
    ).toThrow(/EVENT_VALIDATION_ERROR|id/);
  });

  it("rejects events missing type-specific portable payloads", () => {
    expect(() =>
      parsePortableRunEvent({
        id: "missing-text",
        provider: "mock",
        runId: "run",
        seq: 1,
        sessionId: "session",
        ts: "2026-01-01T00:00:00.000Z",
        type: "assistant.message.delta"
      })
    ).toThrow(/EVENT_VALIDATION_ERROR|text/);

    expect(() =>
      parsePortableRunEvent({
        id: "missing-diff",
        provider: "mock",
        runId: "run",
        seq: 1,
        sessionId: "session",
        ts: "2026-01-01T00:00:00.000Z",
        type: "diff.updated"
      })
    ).toThrow(/EVENT_VALIDATION_ERROR|unifiedDiff/);
  });

  it("exports JSON schemas for config, event, and session ledger artifacts", () => {
    expect(configJsonSchema()).toMatchObject({
      $id: "https://metaharness.dev/schemas/metaharness.config.schema.json",
      properties: {
        workspace: {
          properties: {
            cwd: {
              type: "string"
            }
          },
          required: ["cwd"]
        }
      },
      required: ["workspace"],
      title: "metaharness config"
    });
    expect(eventJsonSchema()).toMatchObject({
      $id: "https://metaharness.dev/schemas/event.schema.json",
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          properties: expect.objectContaining({
            type: {
              const: "run.started",
              type: "string"
            }
          }),
          required: expect.arrayContaining([
            "id",
            "ts",
            "provider",
            "runId",
            "sessionId",
            "seq",
            "type",
            "input"
          ])
        })
      ])
    });
    expect(sessionLedgerJsonSchema()).toMatchObject({
      $id: "https://metaharness.dev/schemas/session-ledger.schema.json",
      properties: {
        schemaVersion: {
          const: "metaharness.session-ledger.v1"
        },
        task: {
          properties: {
            originalPrompt: {
              type: "string"
            }
          }
        }
      },
      required: expect.arrayContaining(["schemaVersion", "ledgerId", "task"]),
      title: "metaharness session ledger"
    });
  });
});

function baseEvent(type: PortableRunEventType) {
  return {
    id: `${type}-id`,
    provider: "mock",
    runId: "run",
    seq: 1,
    sessionId: "session",
    ts: "2026-01-01T00:00:00.000Z",
    type
  };
}

function eventForType(type: PortableRunEventType): unknown {
  switch (type) {
    case "run.started":
      return {
        ...baseEvent(type),
        input: {
          mode: "edit",
          taskHash: "hash"
        }
      };
    case "run.status":
      return {
        ...baseEvent(type),
        status: "running"
      };
    case "assistant.message.delta":
    case "assistant.message.completed":
      return {
        ...baseEvent(type),
        text: "hello"
      };
    case "plan.updated":
      return {
        ...baseEvent(type),
        steps: [
          {
            status: "completed",
            step: "Inspect"
          }
        ]
      };
    case "tool.started":
      return {
        ...baseEvent(type),
        tool: {
          kind: "built_in",
          name: "Read"
        }
      };
    case "tool.delta":
      return {
        ...baseEvent(type),
        text: "tool output"
      };
    case "tool.finished":
      return {
        ...baseEvent(type),
        tool: {
          kind: "built_in",
          name: "Read"
        }
      };
    case "command.started":
      return {
        ...baseEvent(type),
        command: "pnpm test"
      };
    case "command.output.delta":
      return {
        ...baseEvent(type),
        stream: "stdout",
        text: "ok"
      };
    case "command.finished":
      return {
        ...baseEvent(type),
        command: "pnpm test",
        exitCode: 0
      };
    case "file.change.started":
      return {
        ...baseEvent(type),
        changeKind: "modify",
        path: "src/index.ts"
      };
    case "file.change.updated":
      return {
        ...baseEvent(type),
        path: "src/index.ts"
      };
    case "file.change.finished":
      return {
        ...baseEvent(type),
        changeKind: "modify",
        path: "src/index.ts",
        status: "completed"
      };
    case "diff.updated":
      return {
        ...baseEvent(type),
        unifiedDiff: "diff --git a/a b/a\n"
      };
    case "approval.requested":
      return {
        ...baseEvent(type),
        approvalId: "approval-1",
        availableDecisions: ["accept", "decline"],
        category: "command"
      };
    case "approval.resolved":
      return {
        ...baseEvent(type),
        approvalId: "approval-1",
        decision: "accept"
      };
    case "usage.updated":
      return {
        ...baseEvent(type),
        usage: {
          totalTokens: 1
        }
      };
    case "artifact.created":
      return {
        ...baseEvent(type),
        artifact: {
          kind: "patch",
          name: "diff.patch"
        }
      };
    case "error":
      return {
        ...baseEvent(type),
        error: {
          message: "failed"
        }
      };
    case "run.completed":
      return {
        ...baseEvent(type),
        status: "success"
      };
    case "provider.raw":
      return {
        ...baseEvent(type),
        raw: {
          type: "native"
        }
      };
  }
}
