import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { FileRunStore, HarnessError, renderHandoffMarkdown } from "@metaharness/core";
import { loadConfig } from "../load-config.js";
import {
  assertRunArtifactDirectory,
  assertRunArtifactFile,
  requireRunId,
  resolveRunIdAlias
} from "../run-artifacts.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import type { CliIO, GlobalOptions } from "../types.js";
import type { RunPaths, RunResult, SessionLedger } from "@metaharness/core";

export interface LedgerOptions extends GlobalOptions {
  json?: boolean;
  out?: string;
}

export async function ledgerShowCommand(
  runId: string | undefined,
  options: LedgerOptions,
  io: CliIO
): Promise<void> {
  const {
    ledger,
    paths,
    result,
    runId: resolvedRunId
  } = await loadRun(runId, options, "hk ledger show");
  if (options.json) {
    io.stdout.write(`${JSON.stringify(ledger, null, 2)}\n`);
    return;
  }
  io.stdout.write(renderLedgerSummary(resolvedRunId, ledger, result, paths));
}

export async function ledgerExportCommand(
  runId: string | undefined,
  options: LedgerOptions,
  io: CliIO
): Promise<void> {
  const ledger = await loadLedger(runId, options, "hk ledger export");
  const output = JSON.stringify(ledger, null, 2);
  if (options.out) {
    const outputPath = await writeOutputFile(options, `${output}\n`);
    io.stdout.write(`wrote ${outputPath}\n`);
    return;
  }
  io.stdout.write(`${output}\n`);
}

export async function ledgerHandoffCommand(
  runId: string | undefined,
  options: LedgerOptions,
  io: CliIO
): Promise<void> {
  const ledger = await loadLedger(runId, options, "hk ledger handoff");
  const markdown = renderHandoffMarkdown(ledger);
  if (options.out) {
    const outputPath = await writeOutputFile(options, markdown);
    io.stdout.write(`wrote ${outputPath}\n`);
    return;
  }
  io.stdout.write(markdown);
}

async function writeOutputFile(options: LedgerOptions, content: string): Promise<string> {
  if (!options.out) {
    throw new HarnessError("Missing output path.", "OUTPUT_PATH_MISSING");
  }
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const outputPath = resolve(cwd, options.out);
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(outputPath, content, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "EISDIR") {
      throw new HarnessError(
        [
          `Output path is a directory: ${outputPath}`,
          "Pass --out <file>, not a directory."
        ].join("\n"),
        "OUTPUT_PATH_INVALID"
      );
    }
    throw new HarnessError(
      `Unable to write output file "${outputPath}": ${formatError(error)}`,
      "OUTPUT_WRITE_ERROR"
    );
  }
  return outputPath;
}

async function loadLedger(
  runId: string | undefined,
  options: GlobalOptions,
  commandName: string
): Promise<SessionLedger> {
  return (await loadRun(runId, options, commandName)).ledger;
}

async function loadRun(
  runId: string | undefined,
  options: GlobalOptions,
  commandName: string
): Promise<{
  ledger: SessionLedger;
  paths: RunPaths;
  result: RunResult;
  runId: string;
}> {
  const requestedRunId = requireRunId(runId, commandName);
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const config = await loadConfig(
    options.config ? { configPath: options.config, cwd } : { cwd }
  );
  const store = new FileRunStore(config);
  const resolvedRunId = await resolveRunIdAlias({
    commandName,
    runId: requestedRunId,
    runsRoot: resolve(store.rootDir, "runs")
  });
  const paths = store.paths(resolvedRunId);
  await assertRunArtifactDirectory({
    path: paths.runDir,
    runId: resolvedRunId
  });
  await assertRunArtifactFile({
    label: "Run ledger",
    path: paths.ledger,
    runId: resolvedRunId
  });
  await assertRunArtifactFile({
    label: "Run result",
    path: paths.result,
    runId: resolvedRunId
  });
  return {
    ledger: await store.readLedger(resolvedRunId),
    paths,
    result: await store.readResult(resolvedRunId),
    runId: resolvedRunId
  };
}

function renderLedgerSummary(
  runId: string,
  ledger: SessionLedger,
  result: RunResult,
  paths: RunPaths
): string {
  const lines = [
    `run ${runId}`,
    `status ${result.status}`,
    `provider ${formatProvider(ledger)}`,
    `workspace ${ledger.workspace.cwd}`,
    `summary ${ledger.summary.finalMessage ?? "none"}`,
    "artifacts",
    `  events ${ledger.events.eventLogPath}`,
    `  result ${paths.result}`,
    `  ledger ${paths.ledger}`,
    `  handoff ${result.handoffPath ?? paths.handoff}`,
    `  patch ${ledger.diff.patchPath ?? result.patchPath ?? "not captured"}`,
    `  verification ${result.verificationLogPath ?? paths.verification}`,
    `  raw-events ${ledger.events.rawEventLogPath ?? "not captured"}`
  ];

  if (ledger.diff.stats) {
    lines.push(
      `diff ${ledger.diff.stats.filesChanged} files${
        ledger.diff.stats.insertions === undefined
          ? ""
          : `, +${ledger.diff.stats.insertions}`
      }${
        ledger.diff.stats.deletions === undefined
          ? ""
          : `, -${ledger.diff.stats.deletions}`
      }`
    );
  } else if (ledger.diff.patchPath) {
    lines.push("diff patch captured");
  } else {
    lines.push("diff not captured");
  }

  if (ledger.files.changed.length > 0) {
    lines.push(`changed ${ledger.files.changed.length}`);
    for (const file of ledger.files.changed.slice(0, 10)) {
      lines.push(`  ${file.kind} ${file.path}`);
    }
    if (ledger.files.changed.length > 10) {
      lines.push(`  ... ${ledger.files.changed.length - 10} more`);
    }
  } else {
    lines.push("changed none");
  }

  if (ledger.verification.length > 0) {
    lines.push("verification");
    for (const entry of ledger.verification) {
      const status = entry.exitCode === 0 ? "ok" : `exit ${entry.exitCode ?? "unknown"}`;
      lines.push(`  ${status} ${entry.command}`);
    }
  } else {
    lines.push("verification none");
  }

  lines.push(
    `events ${Object.entries(ledger.events.counts)
      .map(([type, count]) => `${type}:${count}`)
      .join(", ")}`
  );
  lines.push(
    "next",
    `  hk stream ${runId}`,
    `  hk ledger export ${runId} --out ledger.json`,
    `  hk ledger handoff ${runId}`,
    "  hk runs"
  );

  return `${lines.join("\n")}\n`;
}

function formatProvider(ledger: SessionLedger): string {
  const details = [
    ledger.provider.model,
    ledger.provider.runtime,
    ledger.provider.nativeSessionId
      ? `native-session:${ledger.provider.nativeSessionId}`
      : undefined,
    ledger.provider.nativeUrl
  ].filter((value) => value !== undefined);
  return details.length > 0
    ? `${ledger.provider.id} (${details.join(", ")})`
    : ledger.provider.id;
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
