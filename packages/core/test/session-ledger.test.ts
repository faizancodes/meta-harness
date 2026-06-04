import { describe, expect, it } from "vitest";
import { buildSessionLedger } from "../src/index.js";
import type { PortableRunEvent, RunPaths } from "../src/index.js";

describe("buildSessionLedger", () => {
  it("captures tool input/output context and read-file hints", () => {
    const runId = "mock-run-ledger";
    const sessionId = "mock-session-ledger";
    const circular: Record<string, unknown> = {
      ok: true
    };
    circular.self = circular;

    const events: PortableRunEvent[] = [
      {
        id: "event-1",
        input: {
          cwd: "/repo",
          mode: "edit",
          taskHash: "hash"
        },
        provider: "mock",
        runId,
        seq: 1,
        sessionId,
        ts: "2026-01-01T00:00:00.000Z",
        type: "run.started"
      },
      {
        id: "event-2",
        input: {
          path: "src/index.ts"
        },
        provider: "mock",
        runId,
        seq: 2,
        sessionId,
        tool: {
          kind: "built_in",
          name: "Read"
        },
        ts: "2026-01-01T00:00:01.000Z",
        type: "tool.started"
      },
      {
        id: "event-3",
        output: circular,
        provider: "mock",
        runId,
        seq: 3,
        sessionId,
        tool: {
          kind: "built_in",
          name: "Read"
        },
        ts: "2026-01-01T00:00:02.000Z",
        type: "tool.finished"
      },
      {
        id: "event-4",
        provider: "mock",
        runId,
        seq: 4,
        sessionId,
        ts: "2026-01-01T00:00:03.000Z",
        type: "usage.updated",
        usage: {
          cacheReadTokens: 3,
          cacheWriteTokens: 4,
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 34
        }
      },
      {
        id: "event-5",
        phase: "final",
        provider: "mock",
        runId,
        seq: 5,
        sessionId,
        text: "Done.",
        ts: "2026-01-01T00:00:04.000Z",
        type: "assistant.message.completed"
      }
    ];

    const ledger = buildSessionLedger({
      config: {
        workspace: {
          cwd: "/repo"
        }
      },
      events,
      input: {
        task: "Inspect src/index.ts"
      },
      paths: runPaths(runId),
      result: {
        artifacts: [],
        finalMessage: "Done.",
        provider: "mock",
        runId,
        sessionId,
        status: "success"
      }
    });

    expect(ledger.files.read).toEqual(["src/index.ts"]);
    expect(ledger.usage).toEqual({
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 34
    });
    expect(ledger.tools).toEqual([
      expect.objectContaining({
        inputSummary: '{"path":"src/index.ts"}',
        kind: "built_in",
        name: "Read"
      }),
      expect.objectContaining({
        kind: "built_in",
        name: "Read",
        outputSummary: '{"ok":true,"self":"[Circular]"}'
      })
    ]);
    expect(ledger.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          summary: '{"ok":true,"self":"[Circular]"}',
          providerEventRef: "event-3"
        }),
        expect.objectContaining({
          role: "assistant",
          text: "Done.",
          providerEventRef: "event-5"
        })
      ])
    );
  });

  it("derives missing changed-file ledger entries from captured diffs", () => {
    const runId = "mock-run-diff-ledger";
    const sessionId = "mock-session-diff-ledger";
    const diff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index 1111111..2222222 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1 +1 @@",
      "-export const value = 1;",
      "+export const value = 2;",
      "diff --git a/old-name.ts b/new-name.ts",
      "similarity index 100%",
      "rename from old-name.ts",
      "rename to new-name.ts",
      "diff --metaharness /dev/null b/SNAPSHOT.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/SNAPSHOT.md",
      "@@ -0,0 +1,1 @@",
      "+snapshot",
      ""
    ].join("\n");

    const events: PortableRunEvent[] = [
      {
        id: "event-1",
        input: {
          cwd: "/repo",
          mode: "edit",
          taskHash: "hash"
        },
        provider: "mock",
        runId,
        seq: 1,
        sessionId,
        ts: "2026-01-01T00:00:00.000Z",
        type: "run.started"
      },
      {
        id: "event-2",
        provider: "mock",
        runId,
        seq: 2,
        sessionId,
        ts: "2026-01-01T00:00:01.000Z",
        type: "diff.updated",
        unifiedDiff: diff
      }
    ];

    const ledger = buildSessionLedger({
      config: {
        workspace: {
          cwd: "/repo"
        }
      },
      events,
      input: {
        task: "Update files"
      },
      paths: runPaths(runId),
      result: {
        artifacts: [],
        diff,
        provider: "mock",
        runId,
        sessionId,
        status: "success"
      }
    });

    expect(ledger.files.changed).toEqual([
      expect.objectContaining({
        kind: "modify",
        path: "src/index.ts"
      }),
      expect.objectContaining({
        kind: "rename",
        path: "new-name.ts"
      }),
      expect.objectContaining({
        kind: "create",
        path: "SNAPSHOT.md"
      })
    ]);
    expect(ledger.files.changed[0]?.diff).toContain("+export const value = 2;");
    expect(ledger.files.changed[2]?.diff).toContain("+snapshot");
  });

  it("keeps provider file events authoritative while adding missing diff blocks and artifact events", () => {
    const runId = "mock-run-artifact-ledger";
    const sessionId = "mock-session-artifact-ledger";
    const diff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "index 1111111..2222222 100644",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/extra.ts b/extra.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/extra.ts",
      "@@ -0,0 +1 @@",
      "+extra",
      ""
    ].join("\n");

    const events: PortableRunEvent[] = [
      {
        id: "event-1",
        input: {
          cwd: "/repo",
          mode: "edit",
          taskHash: "hash"
        },
        provider: "mock",
        runId,
        seq: 1,
        sessionId,
        ts: "2026-01-01T00:00:00.000Z",
        type: "run.started"
      },
      {
        changeKind: "unknown",
        id: "event-2",
        path: "src/index.ts",
        provider: "mock",
        runId,
        seq: 2,
        sessionId,
        status: "completed",
        ts: "2026-01-01T00:00:01.000Z",
        type: "file.change.finished"
      },
      {
        id: "event-3",
        provider: "mock",
        runId,
        seq: 3,
        sessionId,
        ts: "2026-01-01T00:00:02.000Z",
        type: "artifact.created",
        artifact: {
          kind: "screenshot",
          name: "preview",
          path: "/repo/preview.png"
        }
      },
      {
        id: "event-4",
        provider: "mock",
        runId,
        seq: 4,
        sessionId,
        ts: "2026-01-01T00:00:03.000Z",
        type: "diff.updated",
        unifiedDiff: diff
      }
    ];

    const ledger = buildSessionLedger({
      config: {
        workspace: {
          cwd: "/repo"
        }
      },
      events,
      input: {
        task: "Capture artifacts"
      },
      paths: runPaths(runId),
      result: {
        artifacts: [
          {
            kind: "branch",
            name: "agent/run"
          }
        ],
        diff,
        provider: "mock",
        runId,
        sessionId,
        status: "success"
      }
    });

    expect(ledger.files.changed).toEqual([
      expect.objectContaining({
        diff: expect.stringContaining("+new"),
        kind: "modify",
        path: "src/index.ts"
      }),
      expect.objectContaining({
        kind: "create",
        path: "extra.ts"
      })
    ]);
    expect(ledger.artifacts).toEqual([
      {
        kind: "branch",
        name: "agent/run"
      },
      {
        kind: "file",
        name: "preview",
        path: "/repo/preview.png"
      }
    ]);
  });
});

function runPaths(runId: string): RunPaths {
  const runDir = `/repo/.harness/runs/${runId}`;
  return {
    events: `${runDir}/events.ndjson`,
    handoff: `${runDir}/handoff.md`,
    ledger: `${runDir}/ledger.json`,
    patch: `${runDir}/diff.patch`,
    rawEvents: `${runDir}/provider/raw-events.ndjson`,
    result: `${runDir}/result.json`,
    runDir,
    verification: `${runDir}/verification.log`
  };
}
