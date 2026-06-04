import { resolve } from "node:path";
import { FileRunStore, HarnessError } from "@metaharness/core";
import { loadConfig } from "../load-config.js";
import { listRunArtifactDirectories } from "../run-artifacts.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import type { CliIO, GlobalOptions } from "../types.js";
import type { ProviderId, RunResult, SessionLedger } from "@metaharness/core";

const defaultRunListLimit = 10;

export interface RunsOptions extends GlobalOptions {
  json?: boolean;
  limit?: string;
}

export interface RunsReport {
  runs: RunListEntry[];
  runsRoot: string;
}

export interface RunListEntry {
  error?: string;
  ledgerPath: string;
  provider?: ProviderId;
  resultPath: string;
  runDir: string;
  runId: string;
  status: RunResult["status"] | "invalid";
  summary?: string;
  task?: string;
  updatedAt: string;
}

export async function runsCommand(options: RunsOptions, io: CliIO): Promise<RunsReport> {
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const config = await loadConfig(
    options.config ? { configPath: options.config, cwd } : { cwd }
  );
  const store = new FileRunStore(config);
  const runsRoot = resolve(store.rootDir, "runs");
  const limit = parsePositiveInteger(
    options.limit ?? String(defaultRunListLimit),
    "--limit"
  );
  const directories = await listRunArtifactDirectories(runsRoot);
  const runs = await Promise.all(
    directories.slice(0, limit).map((directory) => readRunListEntry(store, directory))
  );
  const report = {
    runs,
    runsRoot
  };

  if (options.json) {
    io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    io.stdout.write(renderRunsReport(report));
  }

  return report;
}

async function readRunListEntry(
  store: FileRunStore,
  directory: {
    mtimeMs: number;
    runDir: string;
    runId: string;
  }
): Promise<RunListEntry> {
  const paths = store.paths(directory.runId);
  const base = {
    ledgerPath: paths.ledger,
    resultPath: paths.result,
    runDir: directory.runDir,
    runId: directory.runId,
    updatedAt: new Date(directory.mtimeMs).toISOString()
  };

  let result: RunResult;
  try {
    result = await store.readResult(directory.runId);
  } catch (error) {
    return {
      ...base,
      error: formatError(error),
      status: "invalid"
    };
  }

  const ledger = await readOptionalLedger(store, directory.runId);
  const entry: RunListEntry = {
    ...base,
    provider: result.provider,
    status: result.status
  };
  if (result.finalMessage) {
    entry.summary = result.finalMessage;
  }
  if (ledger?.task.originalPrompt) {
    entry.task = ledger.task.originalPrompt;
  }
  return entry;
}

async function readOptionalLedger(
  store: FileRunStore,
  runId: string
): Promise<SessionLedger | undefined> {
  try {
    return await store.readLedger(runId);
  } catch {
    return undefined;
  }
}

function renderRunsReport(report: RunsReport): string {
  const lines = [`runs ${report.runsRoot}`];
  if (report.runs.length === 0) {
    lines.push("no runs found");
    return `${lines.join("\n")}\n`;
  }

  lines.push("run id\tstatus\tprovider\tupdated\tsummary");
  for (const run of report.runs) {
    lines.push(
      [
        run.runId,
        run.status,
        run.provider ?? "unknown",
        run.updatedAt,
        summarizeRun(run)
      ].join("\t")
    );
  }
  lines.push(
    "next",
    "  hk ledger show latest",
    "  hk stream latest",
    "  hk ledger handoff latest",
    "  hk runs --json"
  );
  return `${lines.join("\n")}\n`;
}

function summarizeRun(run: RunListEntry): string {
  return truncateSummary(run.summary ?? run.task ?? run.error ?? "no summary");
}

function truncateSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) {
    return normalized || "no summary";
  }
  return `${normalized.slice(0, 117)}...`;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new HarnessError(
      `${optionName} must be a positive integer.`,
      "NUMERIC_OPTION_INVALID"
    );
  }
  return parsed;
}

function formatError(error: unknown): string {
  if (error instanceof HarnessError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
