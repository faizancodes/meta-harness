import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileRunStore, RunArtifactError } from "../src/index.js";
import type { SessionLedger } from "../src/index.js";

describe("FileRunStore", () => {
  it("redacts persisted result, ledger, handoff, and compare artifacts by default", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-run-store-redact-"));
    const secret = "run-store-secret-value";
    const token = "sk-123456789012345678901234567890";
    process.env.METAHARNESS_TEST_SECRET = secret;

    try {
      const store = new FileRunStore({
        workspace: {
          cwd
        }
      });
      const runId = "run-redaction";

      const resultPath = await store.writeResult(runId, {
        artifacts: [],
        finalMessage: `final ${secret} ${token}`,
        native: {
          token
        },
        provider: "mock",
        runId,
        sessionId: "session-redaction",
        status: "success"
      });
      const ledgerPath = await store.writeLedger(runId, createLedger(cwd, secret, token));
      const handoffPath = await store.writeHandoff(runId, `handoff ${secret} ${token}`);
      const comparePaths = await store.writeCompare(
        "compare-redaction",
        {
          summary: [
            {
              notes: `compare ${secret} ${token}`,
              provider: "mock",
              status: "success"
            }
          ]
        },
        `compare markdown ${secret} ${token}`
      );

      const persisted = [
        await readFile(resultPath, "utf8"),
        await readFile(ledgerPath, "utf8"),
        await readFile(handoffPath, "utf8"),
        await readFile(comparePaths.json, "utf8"),
        await readFile(comparePaths.markdown, "utf8")
      ].join("\n");

      expect(persisted).not.toContain(secret);
      expect(persisted).not.toContain(token);
      expect(persisted).toContain("[REDACTED]");

      const readResult = await store.readResult(runId);
      expect(readResult.finalMessage).toContain("[REDACTED]");
      expect(readResult.native).toEqual({
        token: "[REDACTED]"
      });
    } finally {
      delete process.env.METAHARNESS_TEST_SECRET;
    }
  });

  it("respects the explicit storage.redactSecrets opt-out", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-run-store-unredacted-"));
    const secret = "run-store-unredacted-value";
    process.env.METAHARNESS_TEST_SECRET = secret;

    try {
      const store = new FileRunStore({
        storage: {
          redactSecrets: false
        },
        workspace: {
          cwd
        }
      });
      const runId = "run-unredacted";
      const resultPath = await store.writeResult(runId, {
        artifacts: [],
        finalMessage: `final ${secret}`,
        provider: "mock",
        runId,
        sessionId: "session-unredacted",
        status: "success"
      });
      const handoffPath = await store.writeHandoff(runId, `handoff ${secret}`);

      expect(await readFile(resultPath, "utf8")).toContain(secret);
      expect(await readFile(handoffPath, "utf8")).toContain(secret);
    } finally {
      delete process.env.METAHARNESS_TEST_SECRET;
    }
  });

  it("reports missing and malformed persisted artifacts with typed errors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-run-store-errors-"));
    const store = new FileRunStore({
      workspace: {
        cwd
      }
    });
    const runId = "missing-run";
    const paths = store.paths(runId);

    await expect(store.readLedger(runId)).rejects.toMatchObject({
      code: "RUN_ARTIFACT_NOT_FOUND",
      details: {
        artifact: "ledger",
        path: paths.ledger,
        runId
      },
      name: "RunArtifactError"
    });
    await expect(store.readLedger(runId)).rejects.toBeInstanceOf(RunArtifactError);

    await mkdir(paths.runDir, { recursive: true });
    await writeFile(paths.result, "{not-json", "utf8");

    await expect(store.readResult(runId)).rejects.toMatchObject({
      code: "RUN_ARTIFACT_INVALID",
      details: {
        artifact: "result",
        path: paths.result,
        runId
      },
      name: "RunArtifactError"
    });
  });
});

function createLedger(cwd: string, secret: string, token: string): SessionLedger {
  return {
    artifacts: [],
    commands: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    diff: {
      unifiedDiff: `diff ${secret} ${token}`
    },
    events: {
      counts: {},
      eventLogPath: "events.ndjson"
    },
    files: {
      changed: [],
      read: []
    },
    ledgerId: "ledger-redaction",
    plans: [],
    provider: {
      id: "mock"
    },
    schemaVersion: "metaharness.session-ledger.v1",
    summary: {
      facts: [`fact ${secret}`],
      finalMessage: `summary ${secret} ${token}`,
      nextSteps: [],
      openQuestions: []
    },
    task: {
      mode: "ask",
      originalPrompt: `prompt ${secret} ${token}`
    },
    tools: [],
    transcript: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    verification: [],
    workspace: {
      cwd,
      dirtyAfter: false,
      dirtyBefore: false
    }
  };
}
