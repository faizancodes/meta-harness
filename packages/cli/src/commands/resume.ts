import { createCliHarness } from "../harness.js";
import { loadConfig } from "../load-config.js";
import { parseProviderId } from "../provider-options.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import { HarnessError } from "@metaharness/core";
import {
  applyRunSessionOptions,
  assertRunResultSucceeded,
  assertCompatibleOutputOptions,
  renderEventStream,
  resolveTask,
  writeRunResultNextSteps
} from "./run.js";
import type { CliIO, GlobalOptions } from "../types.js";
import type {
  ProviderId,
  ResumeRunInput,
  RunResult,
  SessionLedger
} from "@metaharness/core";

export interface ResumeOptions extends GlobalOptions {
  json?: boolean;
  model?: string;
  provider?: ProviderId;
  rawEvents?: boolean;
  run?: string;
  runtime?: string;
  session?: string;
  stream?: boolean;
  task?: string;
  taskFile?: string;
  verify?: string[];
}

export async function resumeCommand(
  options: ResumeOptions,
  io: CliIO
): Promise<RunResult> {
  assertCompatibleOutputOptions(options);
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const task = await resolveTask(options, cwd);
  const config = await loadConfig(
    options.config ? { configPath: options.config, cwd } : { cwd }
  );
  const harness = createCliHarness(config);
  const sourceLedger = options.run ? await harness.exportLedger(options.run) : undefined;
  const provider =
    (options.provider ? parseProviderId(options.provider) : undefined) ??
    sourceLedger?.provider.id ??
    config.defaultProvider;

  if (!provider) {
    throw new HarnessError(
      "Missing provider. Pass --provider or --run with a recorded ledger.",
      "RESUME_PROVIDER_MISSING"
    );
  }

  const resumeInput: ResumeRunInput & { provider: ProviderId } = {
    provider,
    task
  };
  applyRunSessionOptions(resumeInput, options);
  if (options.rawEvents) {
    resumeInput.rawEvents = true;
  }
  if (options.verify && options.verify.length > 0) {
    resumeInput.verification = options.verify;
  }
  if (sourceLedger) {
    resumeInput.ledger = sourceLedger;
    resumeInput.metadata = {
      resumeFrom: resumeFromMetadata(sourceLedger, options.run)
    };
  }
  const nativeSessionId = options.session ?? sourceLedger?.provider.nativeSessionId;
  if (nativeSessionId) {
    resumeInput.nativeSessionId = nativeSessionId;
  }

  const result = options.stream
    ? await resumeWithLiveEvents(harness, resumeInput, io)
    : await harness.resume(resumeInput);

  if (options.json) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    io.stdout.write(`resume ${result.runId} ${result.status}\n`);
    if (result.nativeSessionId) {
      io.stdout.write(`native-session ${result.nativeSessionId}\n`);
    }
    if (result.finalMessage) {
      io.stdout.write(`${result.finalMessage}\n`);
    }
    if (result.patchPath) {
      io.stdout.write(`patch ${result.patchPath}\n`);
    }
    writeRunResultNextSteps(result, io);
  }

  assertRunResultSucceeded(result, "Resume");
  return result;
}

async function resumeWithLiveEvents(
  harness: ReturnType<typeof createCliHarness>,
  input: ResumeRunInput & { provider: ProviderId },
  io: CliIO
): Promise<RunResult> {
  const active = await harness.startResume(input);
  const eventStream = renderEventStream(active.events(), io);
  const result = await active.wait();
  await eventStream;
  return result;
}

function resumeFromMetadata(
  ledger: SessionLedger,
  runId: string | undefined
): Record<string, string> {
  return {
    ledgerId: ledger.ledgerId,
    provider: ledger.provider.id,
    runId: runId ?? ""
  };
}
