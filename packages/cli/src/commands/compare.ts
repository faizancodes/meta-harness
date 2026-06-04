import { createCliHarness } from "../harness.js";
import { loadConfig } from "../load-config.js";
import { parseProviderList } from "../provider-options.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import { resolveTask } from "./run.js";
import { HarnessError } from "@metaharness/core";
import type { CliIO, GlobalOptions } from "../types.js";
import type { CompareInput, CompareResult } from "@metaharness/core";

export interface CompareOptions extends GlobalOptions {
  isolatedWorktrees?: boolean;
  json?: boolean;
  maxConcurrency?: string;
  providers?: string;
  task?: string;
  taskFile?: string;
  verify?: string[];
}

export async function compareCommand(
  options: CompareOptions,
  io: CliIO
): Promise<CompareResult> {
  const providers = parseProviderList(options.providers);
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const task = await resolveTask(options, cwd);
  const config = await loadConfig(
    options.config ? { configPath: options.config, cwd } : { cwd }
  );
  const harness = createCliHarness(config);
  const input: CompareInput = {
    providers,
    strategy: {
      isolatedWorktrees: options.isolatedWorktrees ?? false
    },
    task
  };
  if (options.maxConcurrency) {
    input.strategy = {
      ...input.strategy,
      maxConcurrency: parsePositiveInteger(options.maxConcurrency, "--max-concurrency")
    };
  }
  if (options.verify) {
    input.verification = options.verify;
  }
  const result = await harness.compare(input);

  if (options.json) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout.write(`compare ${result.id}\n`);
    io.stdout.write("provider\tstatus\tverify\trun id\tpatch\n");
    for (const [index, entry] of result.summary.entries()) {
      const runId = result.runs[index]?.runId ?? "unknown-run";
      io.stdout.write(
        `${entry.provider}\t${entry.status}\t${formatVerify(entry.testsPassed)}\t${runId}\t${
          entry.patchPath ?? "no-patch"
        }\n`
      );
    }
    if (result.compareJsonPath) {
      io.stdout.write(`json ${result.compareJsonPath}\n`);
    }
    if (result.compareMarkdownPath) {
      io.stdout.write(`markdown ${result.compareMarkdownPath}\n`);
    }
    writeCompareResultNextSteps(result, io);
  }

  assertCompareResultSucceeded(result);
  return result;
}

export function collectVerify(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function formatVerify(value: boolean | undefined): string {
  if (value === undefined) {
    return "verify:n/a";
  }
  return value ? "verify:pass" : "verify:fail";
}

function writeCompareResultNextSteps(
  result: CompareResult,
  io: Pick<CliIO, "stdout">
): void {
  const lines = ["next"];
  if (result.compareMarkdownPath) {
    lines.push(`  review markdown ${result.compareMarkdownPath}`);
  }
  lines.push(
    "  inspect selected run with hk ledger show <run-id>",
    "  stream selected run with hk stream <run-id>",
    "  list recent runs with hk runs"
  );
  io.stdout.write(`${lines.join("\n")}\n`);
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

function assertCompareResultSucceeded(result: CompareResult): void {
  const failed = result.summary.filter(
    (entry) => entry.status !== "success" || entry.testsPassed === false
  );
  if (failed.length === 0) {
    return;
  }

  const details = failed
    .map((entry) => {
      const verification = entry.testsPassed === false ? ", verification failed" : "";
      return `${entry.provider} ${entry.status}${verification}`;
    })
    .join("; ");
  throw new HarnessError(`Compare ${result.id} failed: ${details}.`, "COMPARE_FAILED");
}
