import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarness } from "@metaharness/core";
import { MockAdapter } from "../src/index.js";
import type { PortableRunEvent } from "@metaharness/core";
import type { SessionLedger } from "@metaharness/core";

describe("MockAdapter", () => {
  it("reports mock-specific capability notes without implying real adapters are missing", async () => {
    const capabilities = await new MockAdapter().capabilities();

    expect(capabilities.tools.mcp).toMatchObject({
      supported: false,
      notes: "Mock does not exercise MCP; real adapters pass provider-native MCP through."
    });
  });

  it("runs through createHarness and writes run artifacts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-mock-"));
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        storage: {
          rootDir: ".harness"
        },
        workspace: {
          cwd
        }
      },
      [new MockAdapter()]
    );

    const result = await harness.run({
      task: "test mock task"
    });

    expect(result.status).toBe("success");
    expect(result.eventLogPath).toBeDefined();
    expect(result.ledgerPath).toBeDefined();
    expect(result.handoffPath).toBeDefined();
    expect(result.patchPath).toBeDefined();

    const events = (await readFile(result.eventLogPath ?? "", "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { seq: number; type: string });
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "assistant.message.delta",
      "assistant.message.completed",
      "plan.updated",
      "command.started",
      "command.finished",
      "file.change.finished",
      "diff.updated",
      "usage.updated",
      "run.completed"
    ]);

    const ledger = JSON.parse(
      await readFile(result.ledgerPath ?? "", "utf8")
    ) as SessionLedger;
    expect(ledger.schemaVersion).toBe("metaharness.session-ledger.v1");
    expect(ledger.events.counts["run.completed"]).toBe(1);
    expect(ledger.commands[0]?.command).toBe("mock verify");
    expect(ledger.files.changed[0]?.path).toBe("MOCK.md");

    const handoff = await readFile(result.handoffPath ?? "", "utf8");
    expect(handoff).toContain("# metaharness handoff");
    expect(handoff).toContain("A patch file is available at:");
  });

  it("marks runs failed when verification fails", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-mock-verify-fail-"));
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd
        }
      },
      [new MockAdapter()]
    );

    const result = await harness.run({
      task: "test failed verification",
      verification: ["echo ok && false"]
    });

    expect(result.status).toBe("failed");
    expect(result.finalMessage).toContain('Verification failed for "echo ok && false"');
    expect(result.finalMessage).toContain(
      "Verification command contains shell operators"
    );

    const ledger = JSON.parse(
      await readFile(result.ledgerPath ?? "", "utf8")
    ) as SessionLedger;
    expect(ledger.verification).toEqual([
      expect.objectContaining({
        command: "echo ok && false",
        exitCode: 1
      })
    ]);
  });

  it("supports deterministic in-flight cancellation for active runs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-mock-cancel-"));
    const harness = createHarness(
      {
        defaultProvider: "mock",
        providers: {
          mock: {
            provider: "mock"
          }
        },
        workspace: {
          cwd
        }
      },
      [new MockAdapter()]
    );

    const active = await harness.startRun({
      native: {
        mock: {
          eventDelayMs: 20
        }
      },
      task: "cancel the mock run"
    });
    const observed: PortableRunEvent[] = [];
    const runStarted = waitForEvent(observed, "run.started");
    const stream = collectEvents(active.events(), observed);

    await runStarted;
    await active.cancel();
    const result = await active.wait();
    await stream;

    expect(result.status).toBe("cancelled");
    expect(result.finalMessage).toBe("Mock run cancelled.");
    expect(observed.map((event) => event.type)).toEqual([
      "run.started",
      "run.status",
      "run.completed"
    ]);
    expect(observed.at(-1)).toMatchObject({
      status: "cancelled",
      type: "run.completed"
    });
  });
});

async function collectEvents(
  source: AsyncIterable<PortableRunEvent>,
  target: PortableRunEvent[]
): Promise<void> {
  for await (const event of source) {
    target.push(event);
  }
}

async function waitForEvent(
  events: PortableRunEvent[],
  type: PortableRunEvent["type"]
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!events.some((event) => event.type === type)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${type}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
