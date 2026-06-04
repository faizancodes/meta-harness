import { createCliHarness } from "../harness.js";
import { loadConfig } from "../load-config.js";
import { parseProviderId } from "../provider-options.js";
import { writeRunResultNextSteps } from "./run.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import { HarnessError } from "@metaharness/core";
import type { CliIO, GlobalOptions } from "../types.js";
import type { HandoffInput, HandoffResult, ProviderId } from "@metaharness/core";

export interface HandoffOptions extends GlobalOptions {
  applyPatch?: boolean;
  fromRun?: string;
  instruction?: string;
  json?: boolean;
  to?: ProviderId;
  verify?: string[];
}

export async function handoffCommand(
  options: HandoffOptions,
  io: CliIO
): Promise<HandoffResult> {
  if (!options.fromRun) {
    throw new HarnessError("Missing --from-run.", "HANDOFF_SOURCE_MISSING");
  }
  if (!options.to) {
    throw new HarnessError("Missing --to provider.", "HANDOFF_PROVIDER_MISSING");
  }
  const toProvider = parseProviderId(options.to, "--to");
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const config = await loadConfig(
    options.config ? { configPath: options.config, cwd } : { cwd }
  );
  const harness = createCliHarness(config);
  const input: HandoffInput = {
    fromRunId: options.fromRun,
    toProvider
  };
  if (options.applyPatch !== undefined) {
    input.applyPatch = options.applyPatch;
  }
  if (options.instruction) {
    input.instruction = options.instruction;
  }
  if (options.verify && options.verify.length > 0) {
    input.verification = options.verify;
  }
  const result = await harness.handoff(input);

  if (options.json) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout.write(`handoff ${options.fromRun} -> ${toProvider}\n`);
    io.stdout.write(`prompt ${result.handoffPromptPath}\n`);
    io.stdout.write(`run ${result.toRun.runId} ${result.toRun.status}\n`);
    if (result.toRun.patchPath) {
      io.stdout.write(`patch ${result.toRun.patchPath}\n`);
    }
    writeRunResultNextSteps(result.toRun, io);
  }

  return result;
}
