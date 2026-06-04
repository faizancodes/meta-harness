import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RunArtifactError } from "./errors.js";
import { FileEventRecorder } from "./event-recorder.js";
import { redactValue } from "./redact.js";
import type { FileEventRecorderOptions } from "./event-recorder.js";
import type { HarnessConfig } from "./types/config.js";
import type { SessionLedger } from "./types/ledger.js";
import type { RunResult } from "./types/result.js";

export interface RunPaths {
  runDir: string;
  events: string;
  result: string;
  ledger: string;
  handoff: string;
  patch: string;
  verification: string;
  rawEvents: string;
}

export interface ComparePaths {
  compareDir: string;
  json: string;
  markdown: string;
}

export class FileRunStore {
  readonly rootDir: string;
  private readonly redactSecrets: boolean;

  constructor(config: HarnessConfig) {
    const configuredRoot = config.storage?.rootDir ?? ".harness";
    this.rootDir = resolve(config.workspace.cwd, configuredRoot);
    this.redactSecrets = config.storage?.redactSecrets !== false;
  }

  paths(runId: string): RunPaths {
    const runDir = resolve(this.rootDir, "runs", runId);
    return {
      runDir,
      events: resolve(runDir, "events.ndjson"),
      result: resolve(runDir, "result.json"),
      ledger: resolve(runDir, "ledger.json"),
      handoff: resolve(runDir, "handoff.md"),
      patch: resolve(runDir, "diff.patch"),
      verification: resolve(runDir, "verification.log"),
      rawEvents: resolve(runDir, "provider", "raw-events.ndjson")
    };
  }

  async ensureRun(runId: string): Promise<RunPaths> {
    const paths = this.paths(runId);
    await mkdir(resolve(paths.runDir, "provider"), { recursive: true });
    return paths;
  }

  createRecorder(
    runId: string,
    options: Pick<FileEventRecorderOptions, "rawEvents" | "redactSecrets">
  ): FileEventRecorder {
    const paths = this.paths(runId);
    return new FileEventRecorder({
      eventsPath: paths.events,
      rawEventsPath: paths.rawEvents,
      ...options
    });
  }

  async writeResult(runId: string, result: RunResult): Promise<string> {
    const paths = await this.ensureRun(runId);
    await writeJson(paths.result, this.redact(result));
    return paths.result;
  }

  async readResult(runId: string): Promise<RunResult> {
    const paths = this.paths(runId);
    return readArtifactJson<RunResult>({
      artifact: "result",
      path: paths.result,
      runId
    });
  }

  async writeLedger(runId: string, ledger: SessionLedger): Promise<string> {
    const paths = await this.ensureRun(runId);
    await writeJson(paths.ledger, this.redact(ledger));
    return paths.ledger;
  }

  async readLedger(runId: string): Promise<SessionLedger> {
    const paths = this.paths(runId);
    return readArtifactJson<SessionLedger>({
      artifact: "ledger",
      path: paths.ledger,
      runId
    });
  }

  async writeHandoff(runId: string, markdown: string): Promise<string> {
    const paths = await this.ensureRun(runId);
    await writeFile(paths.handoff, this.redact(markdown), "utf8");
    return paths.handoff;
  }

  async writePatch(runId: string, diff: string): Promise<string> {
    const paths = await this.ensureRun(runId);
    await writeFile(paths.patch, diff, "utf8");
    return paths.patch;
  }

  comparePaths(compareId: string): ComparePaths {
    const compareDir = resolve(this.rootDir, "compares", compareId);
    return {
      compareDir,
      json: resolve(compareDir, "compare.json"),
      markdown: resolve(compareDir, "compare.md")
    };
  }

  async writeCompare(
    compareId: string,
    json: unknown,
    markdown: string
  ): Promise<ComparePaths> {
    const paths = this.comparePaths(compareId);
    await mkdir(paths.compareDir, { recursive: true });
    await writeJson(paths.json, this.redact(json));
    await writeFile(paths.markdown, this.redact(markdown), "utf8");
    return paths;
  }

  private redact<T>(value: T): T {
    return redactValue(value, {
      enabled: this.redactSecrets
    }) as T;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readArtifactJson<T>(input: {
  artifact: "ledger" | "result";
  path: string;
  runId: string;
}): Promise<T> {
  let content;
  try {
    content = await readFile(input.path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new RunArtifactError(
        [
          `Run ${input.artifact} not found for run "${input.runId}": ${input.path}`,
          "Check the run id, configured workspace.cwd, and storage.rootDir."
        ].join("\n"),
        input,
        "RUN_ARTIFACT_NOT_FOUND"
      );
    }
    throw new RunArtifactError(
      `Unable to read run ${input.artifact} for run "${input.runId}": ${input.path}`,
      input
    );
  }

  try {
    return JSON.parse(content) as T;
  } catch {
    throw new RunArtifactError(
      `Run ${input.artifact} is not valid JSON for run "${input.runId}": ${input.path}`,
      input,
      "RUN_ARTIFACT_INVALID"
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
