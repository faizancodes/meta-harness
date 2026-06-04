import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { EventLogReadError, EventValidationError } from "./errors.js";
import { parsePortableRunEvent } from "./event-schema.js";
import { redactEvent, safeStringify } from "./redact.js";
import type { PortableRunEvent } from "./types/events.js";

export interface EventRecorder {
  append(event: PortableRunEvent): Promise<void>;
  read(runId: string): AsyncIterable<PortableRunEvent>;
  close(): Promise<void>;
}

export interface FileEventRecorderOptions {
  eventsPath: string;
  rawEventsPath: string;
  rawEvents?: boolean;
  redactSecrets?: boolean;
}

export class FileEventRecorder implements EventRecorder {
  private lastSeq = 0;

  constructor(private readonly options: FileEventRecorderOptions) {}

  async append(event: PortableRunEvent): Promise<void> {
    parsePortableRunEvent(event);
    if (event.seq <= this.lastSeq) {
      throw new EventValidationError(
        `Event seq must be monotonic for run "${event.runId}": ${event.seq} <= ${this.lastSeq}`
      );
    }
    this.lastSeq = event.seq;

    const redacted = redactEvent(event, {
      enabled: this.options.redactSecrets !== false
    });
    if (redacted.type === "provider.raw") {
      if (!this.options.rawEvents) {
        return;
      }
      await writeJsonLine(this.options.rawEventsPath, redacted);
      return;
    }
    await writeJsonLine(this.options.eventsPath, redacted);
  }

  async *read(runId: string): AsyncIterable<PortableRunEvent> {
    let content: string;
    try {
      content = await readFile(this.options.eventsPath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw new EventLogReadError(
        `Unable to read event log for run "${runId}": ${this.options.eventsPath}: ${formatError(error)}`,
        {
          path: this.options.eventsPath,
          runId
        }
      );
    }
    let lineNumber = 0;
    for (const line of content.split("\n")) {
      lineNumber += 1;
      if (!line.trim()) {
        continue;
      }
      let value;
      try {
        value = JSON.parse(line);
      } catch (error) {
        throw new EventLogReadError(
          `Event log line ${lineNumber} is not valid JSON for run "${runId}": ${this.options.eventsPath}: ${formatError(error)}`,
          {
            line: lineNumber,
            path: this.options.eventsPath,
            runId
          },
          "EVENT_LOG_INVALID_JSON"
        );
      }
      try {
        yield parsePortableRunEvent(value);
      } catch (error) {
        throw new EventLogReadError(
          `Event log line ${lineNumber} is not a valid portable event for run "${runId}": ${this.options.eventsPath}: ${formatError(error)}`,
          {
            line: lineNumber,
            path: this.options.eventsPath,
            runId
          },
          "EVENT_LOG_INVALID_EVENT"
        );
      }
    }
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}

async function writeJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${safeStringify(value)}\n`, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
