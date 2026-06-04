import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { FileEventRecorder, HarnessError } from "@metaharness/core";
import { createCliHarness } from "../harness.js";
import { loadConfig } from "../load-config.js";
import { parseProviderId } from "../provider-options.js";
import { renderEvent } from "../render/console-events.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import type { CliIO, GlobalOptions } from "../types.js";
import type {
  HarnessConfig,
  PortableRunEvent,
  ProviderConfig,
  ProviderId,
  RunInput,
  RunResult
} from "@metaharness/core";

export interface TaskOptions {
  cwd?: string;
  task?: string;
  taskFile?: string;
}

export interface RunOptions extends GlobalOptions, TaskOptions {
  autoCreatePr?: boolean;
  json?: boolean;
  model?: string;
  prUrl?: string;
  provider?: ProviderId;
  rawEvents?: boolean;
  repo?: string;
  runtime?: string;
  skipReviewerRequest?: boolean;
  startingRef?: string;
  stream?: boolean;
  workOnCurrentBranch?: boolean;
  verify?: string[];
}

export interface CursorCloudRunOptions {
  autoCreatePr?: boolean;
  prUrl?: string;
  repo?: string;
  runtime?: string;
  skipReviewerRequest?: boolean;
  startingRef?: string;
  workOnCurrentBranch?: boolean;
}

export async function runCommand(options: RunOptions, io: CliIO): Promise<RunResult> {
  assertCompatibleOutputOptions(options);
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const task = await resolveTask(options, cwd);
  const provider = options.provider ? parseProviderId(options.provider) : undefined;
  const config = applyCursorCloudOptions(
    await loadConfig(options.config ? { configPath: options.config, cwd } : { cwd }),
    provider,
    options
  );
  const harness = createCliHarness(config);
  const runInput: RunInput & { provider?: ProviderId } = provider
    ? { provider, task }
    : { task };
  applyRunSessionOptions(runInput, options);
  if (options.rawEvents) {
    runInput.rawEvents = true;
  }
  if (options.verify && options.verify.length > 0) {
    runInput.verification = options.verify;
  }
  const result = options.stream
    ? await runWithLiveEvents(harness, runInput, io)
    : await harness.run(runInput);

  if (options.json) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout.write(`run ${result.runId} ${result.status}\n`);
    if (result.finalMessage) {
      io.stdout.write(`${result.finalMessage}\n`);
    }
    if (result.patchPath) {
      io.stdout.write(`patch ${result.patchPath}\n`);
    }
    writeRunResultNextSteps(result, io);
  }

  assertRunResultSucceeded(result, "Run");
  return result;
}

export function writeRunResultNextSteps(
  result: Pick<RunResult, "runId">,
  io: Pick<CliIO, "stdout">
): void {
  io.stdout.write(
    [
      "next",
      `  hk ledger show ${result.runId}`,
      `  hk stream ${result.runId}`,
      `  hk ledger handoff ${result.runId}`,
      "  hk runs"
    ].join("\n") + "\n"
  );
}

export function assertRunResultSucceeded(result: RunResult, label: string): void {
  if (result.status === "success") {
    return;
  }
  const message = result.finalMessage ? ` ${result.finalMessage}` : "";
  throw new HarnessError(
    `${label} ${result.runId} ${result.status}.${message}`,
    "RUN_RESULT_FAILED"
  );
}

export function assertCompatibleOutputOptions(options: {
  json?: boolean;
  stream?: boolean;
}): void {
  if (options.json && options.stream) {
    throw new HarnessError(
      "Use either --json or --stream, not both. --json writes machine-readable output; --stream writes human-readable live events.",
      "OUTPUT_MODE_CONFLICT"
    );
  }
}

export function applyCursorCloudOptions(
  config: HarnessConfig,
  provider: ProviderId | undefined,
  options: CursorCloudRunOptions
): HarnessConfig {
  if (!hasCursorCloudOptions(options)) {
    return config;
  }

  const resolvedProvider = provider ?? config.defaultProvider ?? "mock";
  if (resolvedProvider !== "cursor") {
    throw new HarnessError(
      "Cursor cloud repository options are supported only with --provider cursor.",
      "CURSOR_CLOUD_OPTIONS_INVALID"
    );
  }

  const cursorProvider = config.providers?.cursor;
  const resolvedRuntime = options.runtime
    ? parseRuntime(options.runtime)
    : cursorProvider?.runtime;
  if (resolvedRuntime !== "cloud") {
    throw new HarnessError(
      "Pass --runtime cloud with Cursor cloud repository options.",
      "CURSOR_CLOUD_OPTIONS_INVALID"
    );
  }
  if ((options.startingRef || options.prUrl) && !options.repo) {
    throw new HarnessError(
      "Pass --repo when using --starting-ref or --pr-url.",
      "CURSOR_CLOUD_OPTIONS_INVALID"
    );
  }

  const nextProvider: ProviderConfig = {
    ...(cursorProvider ?? { provider: "cursor" }),
    provider: "cursor"
  };
  if (options.runtime) {
    nextProvider.runtime = "cloud";
  }

  const native = nextProvider.native ?? {};
  const cursorNative = isRecord(native.cursor) ? native.cursor : native;
  const cloud = isRecord(cursorNative.cloud) ? cursorNative.cloud : {};
  const nextCloud: Record<string, unknown> = { ...cloud };
  if (options.repo) {
    nextCloud.repos = [
      {
        ...(options.prUrl ? { prUrl: options.prUrl } : {}),
        ...(options.startingRef ? { startingRef: options.startingRef } : {}),
        url: options.repo
      }
    ];
  }
  if (options.autoCreatePr !== undefined) {
    nextCloud.autoCreatePR = options.autoCreatePr;
  }
  if (options.skipReviewerRequest !== undefined) {
    nextCloud.skipReviewerRequest = options.skipReviewerRequest;
  }
  if (options.workOnCurrentBranch !== undefined) {
    nextCloud.workOnCurrentBranch = options.workOnCurrentBranch;
  }

  return {
    ...config,
    providers: {
      ...(config.providers ?? {}),
      cursor: {
        ...nextProvider,
        native: {
          ...native,
          cursor: {
            ...cursorNative,
            cloud: nextCloud
          }
        }
      }
    }
  };
}

export function applyRunSessionOptions(
  input: Pick<RunInput, "model" | "runtime">,
  options: {
    model?: string;
    runtime?: string;
  }
): void {
  if (options.model) {
    input.model = options.model;
  }
  if (options.runtime) {
    input.runtime = parseRuntime(options.runtime);
  }
}

function parseRuntime(value: string): NonNullable<RunInput["runtime"]> {
  if (value === "local" || value === "cloud" || value === "self-hosted") {
    return value;
  }
  throw new HarnessError(
    `Unsupported runtime "${value}". Expected local, cloud, or self-hosted.`,
    "RUNTIME_UNSUPPORTED"
  );
}

export async function resolveTask(
  options: TaskOptions,
  cwd = options.cwd ?? process.cwd()
): Promise<string> {
  if (options.task !== undefined && options.taskFile) {
    throw new HarnessError(
      "Use either --task or --task-file, not both.",
      "TASK_INPUT_CONFLICT"
    );
  }
  if (options.taskFile) {
    const taskCwd = await resolveWorkspaceCwd(cwd);
    const taskFilePath = resolve(taskCwd, options.taskFile);
    let task: string;
    try {
      task = await readFile(taskFilePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new HarnessError(
          [
            `Task file not found: ${taskFilePath}`,
            "--task-file is resolved relative to --cwd."
          ].join("\n"),
          "TASK_FILE_NOT_FOUND"
        );
      }
      if (isNodeError(error) && error.code === "EISDIR") {
        throw new HarnessError(
          [
            `Task file is a directory: ${taskFilePath}`,
            "Pass --task-file <file> or use --task for inline text."
          ].join("\n"),
          "TASK_FILE_PATH_INVALID"
        );
      }
      throw new HarnessError(
        `Unable to read task file "${taskFilePath}": ${formatError(error)}`,
        "TASK_FILE_READ_ERROR"
      );
    }
    if (!hasTaskText(task)) {
      throw new HarnessError(
        [
          `Task file is empty: ${taskFilePath}`,
          "Pass a task file with non-whitespace prompt text, or use --task for inline text."
        ].join("\n"),
        "TASK_MISSING"
      );
    }
    return task;
  }
  if (options.task !== undefined) {
    if (!hasTaskText(options.task)) {
      throw new HarnessError(
        "Task must contain non-whitespace text. Pass --task <text> or --task-file <file>.",
        "TASK_MISSING"
      );
    }
    return options.task;
  }
  throw new HarnessError(
    "Missing required task. Pass --task or --task-file.",
    "TASK_MISSING"
  );
}

function hasTaskText(value: string): boolean {
  return value.trim().length > 0;
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

function hasCursorCloudOptions(options: CursorCloudRunOptions): boolean {
  return (
    options.autoCreatePr !== undefined ||
    options.prUrl !== undefined ||
    options.repo !== undefined ||
    options.skipReviewerRequest !== undefined ||
    options.startingRef !== undefined ||
    options.workOnCurrentBranch !== undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function renderEvents(
  eventLogPath: string,
  runId: string,
  io: CliIO
): Promise<void> {
  const recorder = new FileEventRecorder({
    eventsPath: eventLogPath,
    rawEventsPath: "",
    rawEvents: false,
    redactSecrets: true
  });
  for await (const event of recorder.read(runId)) {
    io.stdout.write(`${renderEvent(event)}\n`);
  }
}

export async function renderEventStream(
  events: AsyncIterable<PortableRunEvent>,
  io: CliIO
): Promise<void> {
  for await (const event of events) {
    io.stdout.write(`${renderEvent(event)}\n`);
  }
}

async function runWithLiveEvents(
  harness: ReturnType<typeof createCliHarness>,
  input: RunInput & { provider?: ProviderId },
  io: CliIO
): Promise<RunResult> {
  const active = await harness.startRun(input);
  const eventStream = renderEventStream(active.events(), io);
  const result = await active.wait();
  await eventStream;
  return result;
}
