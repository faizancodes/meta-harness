import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness, LedgerImportError } from "../src/index.js";
import type { SessionLedger } from "../src/index.js";

describe("ledger import", () => {
  it("reports missing and malformed imported ledger files with typed errors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-ledger-import-"));
    const harness = createHarness({
      workspace: {
        cwd
      }
    });
    const missingPath = join(cwd, "missing-ledger.json");

    await expect(harness.importLedger(missingPath)).rejects.toMatchObject({
      code: "LEDGER_IMPORT_NOT_FOUND",
      details: {
        path: missingPath
      },
      name: "LedgerImportError"
    });
    await expect(harness.importLedger(missingPath)).rejects.toBeInstanceOf(
      LedgerImportError
    );

    const invalidPath = join(cwd, "invalid-ledger.json");
    await writeFile(invalidPath, "{not-json", "utf8");

    await expect(harness.importLedger(invalidPath)).rejects.toMatchObject({
      code: "LEDGER_IMPORT_INVALID",
      details: {
        path: invalidPath
      },
      name: "LedgerImportError"
    });

    const wrongShapePath = join(cwd, "wrong-ledger.json");
    await writeFile(wrongShapePath, "{}\n", "utf8");

    await expect(harness.importLedger(wrongShapePath)).rejects.toMatchObject({
      code: "LEDGER_IMPORT_INVALID",
      details: {
        path: wrongShapePath
      },
      name: "LedgerImportError"
    });
  });

  it("validates imported ledgers without stripping unknown metadata", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-ledger-import-extra-"));
    const harness = createHarness({
      workspace: {
        cwd
      }
    });
    const ledgerPath = join(cwd, "ledger.json");
    const ledger = {
      ...createLedger(cwd),
      futureMetadata: {
        kept: true
      }
    };
    await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");

    const imported = (await harness.importLedger(ledgerPath)) as SessionLedger & {
      futureMetadata?: {
        kept: boolean;
      };
    };

    expect(imported.schemaVersion).toBe("metaharness.session-ledger.v1");
    expect(imported.futureMetadata).toEqual({
      kept: true
    });
  });
});

function createLedger(cwd: string): SessionLedger {
  return {
    artifacts: [],
    commands: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    diff: {},
    events: {
      counts: {},
      eventLogPath: "events.ndjson"
    },
    files: {
      changed: [],
      read: []
    },
    ledgerId: "ledger-import",
    plans: [],
    provider: {
      id: "mock"
    },
    schemaVersion: "metaharness.session-ledger.v1",
    summary: {
      facts: [],
      nextSteps: [],
      openQuestions: []
    },
    task: {
      mode: "ask",
      originalPrompt: "import ledger"
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
