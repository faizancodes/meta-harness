import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EventLogReadError,
  FileEventRecorder,
  parsePortableRunEvent
} from "../src/index.js";
import type {
  AssistantMessageDeltaEvent,
  BaseEvent,
  RawProviderEvent,
  RunStartedEvent,
  UsageUpdatedEvent
} from "../src/index.js";

describe("FileEventRecorder", () => {
  it("writes redacted JSONL events and enforces monotonic seq", async () => {
    const dir = await mkdtemp(join(tmpdir(), "metaharness-recorder-"));
    const recorder = new FileEventRecorder({
      eventsPath: join(dir, "events.ndjson"),
      rawEventsPath: join(dir, "provider", "raw-events.ndjson"),
      rawEvents: false,
      redactSecrets: true
    });
    const started: RunStartedEvent = {
      ...baseEvent(1),
      input: {
        mode: "edit",
        taskHash: "hash"
      },
      type: "run.started"
    };
    const delta: AssistantMessageDeltaEvent = {
      ...baseEvent(2),
      text: "secret sk-123456789012345678901234567890 should be redacted",
      type: "assistant.message.delta"
    };

    await recorder.append(started);
    await recorder.append(delta);

    await expect(recorder.append(delta)).rejects.toThrow(/monotonic/);

    const lines = (await readFile(join(dir, "events.ndjson"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).not.toContain("sk-123456789012345678901234567890");
    expect(lines[1]).toContain("[REDACTED]");
    expect(parsePortableRunEvent(JSON.parse(lines[0] ?? "{}")).type).toBe("run.started");
  });

  it("does not persist raw provider events unless enabled", async () => {
    const dir = await mkdtemp(join(tmpdir(), "metaharness-raw-"));
    const recorder = new FileEventRecorder({
      eventsPath: join(dir, "events.ndjson"),
      rawEventsPath: join(dir, "provider", "raw-events.ndjson"),
      rawEvents: false,
      redactSecrets: true
    });
    await recorder.append({
      ...baseEvent(1),
      providerEventType: "mock.raw",
      raw: {
        token: "secret-token-value"
      },
      type: "provider.raw"
    } satisfies RawProviderEvent);
    await expect(readFile(join(dir, "events.ndjson"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      readFile(join(dir, "provider", "raw-events.ndjson"), "utf8")
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("preserves usage token counters while redacting secret token fields", async () => {
    const dir = await mkdtemp(join(tmpdir(), "metaharness-recorder-usage-redact-"));
    const recorder = new FileEventRecorder({
      eventsPath: join(dir, "events.ndjson"),
      rawEventsPath: join(dir, "provider", "raw-events.ndjson"),
      rawEvents: true,
      redactSecrets: true
    });

    await recorder.append({
      ...baseEvent(1),
      type: "usage.updated",
      usage: {
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30
      }
    } satisfies UsageUpdatedEvent);
    await recorder.append({
      ...baseEvent(2),
      providerEventType: "mock.raw",
      raw: {
        accessToken: "secret-token-value",
        token: "another-secret-token-value",
        tokenUsage: {
          totalTokens: 30
        }
      },
      type: "provider.raw"
    } satisfies RawProviderEvent);

    const eventLines = (await readFile(join(dir, "events.ndjson"), "utf8"))
      .trim()
      .split("\n");
    const usageEvent = JSON.parse(eventLines[0] ?? "{}") as UsageUpdatedEvent;
    expect(usageEvent.usage).toEqual({
      cacheReadTokens: 3,
      cacheWriteTokens: 4,
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30
    });

    const rawLines = (await readFile(join(dir, "provider", "raw-events.ndjson"), "utf8"))
      .trim()
      .split("\n");
    expect(rawLines[0]).not.toContain("secret-token-value");
    expect(rawLines[0]).toContain('"accessToken":"[REDACTED]"');
    expect(rawLines[0]).toContain('"token":"[REDACTED]"');
    expect(rawLines[0]).toContain('"tokenUsage":{"totalTokens":30}');
  });

  it("reports invalid event log JSON with path and line diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "metaharness-recorder-invalid-json-"));
    const eventsPath = join(dir, "events.ndjson");
    const recorder = new FileEventRecorder({
      eventsPath,
      rawEventsPath: join(dir, "provider", "raw-events.ndjson"),
      rawEvents: false,
      redactSecrets: true
    });
    await writeFile(eventsPath, '{"type": "run.started"\n', "utf8");

    await expect(readAllEvents(recorder)).rejects.toMatchObject({
      code: "EVENT_LOG_INVALID_JSON",
      details: {
        line: 1,
        path: eventsPath,
        runId: "mock-run"
      },
      name: "EventLogReadError"
    });
    await expect(readAllEvents(recorder)).rejects.toBeInstanceOf(EventLogReadError);
  });

  it("reports schema-invalid event log lines with path and line diagnostics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "metaharness-recorder-invalid-event-"));
    const eventsPath = join(dir, "events.ndjson");
    const recorder = new FileEventRecorder({
      eventsPath,
      rawEventsPath: join(dir, "provider", "raw-events.ndjson"),
      rawEvents: false,
      redactSecrets: true
    });
    await writeFile(
      eventsPath,
      `${JSON.stringify({
        id: "event-1",
        provider: "mock",
        runId: "mock-run",
        seq: 1,
        sessionId: "mock-session",
        ts: new Date(1000).toISOString(),
        type: "not-a-portable-event"
      })}\n`,
      "utf8"
    );

    await expect(readAllEvents(recorder)).rejects.toMatchObject({
      code: "EVENT_LOG_INVALID_EVENT",
      details: {
        line: 1,
        path: eventsPath,
        runId: "mock-run"
      },
      name: "EventLogReadError"
    });
  });
});

async function readAllEvents(recorder: FileEventRecorder): Promise<void> {
  for await (const event of recorder.read("mock-run")) {
    void event;
    // Exhaust the async iterator.
  }
}

function baseEvent(seq: number): BaseEvent {
  return {
    id: `event-${seq}`,
    provider: "mock",
    runId: "mock-run",
    seq,
    sessionId: "mock-session",
    ts: new Date(seq * 1000).toISOString()
  };
}
