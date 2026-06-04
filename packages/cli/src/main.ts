import { Command, CommanderError } from "commander";
import { HarnessError } from "@metaharness/core";
import { collectVerify, compareCommand } from "./commands/compare.js";
import { docsCapabilitiesCommand } from "./commands/docs.js";
import { doctorCommand } from "./commands/doctor.js";
import { handoffCommand } from "./commands/handoff.js";
import { shutdownCliTelemetry } from "./harness.js";
import { initCommand } from "./commands/init.js";
import {
  ledgerExportCommand,
  ledgerHandoffCommand,
  ledgerShowCommand
} from "./commands/ledger.js";
import { policyCheckCommand, policyCompileCommand } from "./commands/policy.js";
import { supportedProviderList } from "./provider-options.js";
import { resumeCommand } from "./commands/resume.js";
import { runCommand } from "./commands/run.js";
import { runsCommand } from "./commands/runs.js";
import { streamCommand } from "./commands/stream.js";
import type { CliIO } from "./types.js";

const commanderUsageErrorCode = "CLI_USAGE_ERROR";

export function createProgram(io: CliIO = defaultIO()): Command {
  const program = new Command();
  program
    .name("hk")
    .description("Run Claude, Cursor, Codex, and mock coding agents through metaharness")
    .version("0.0.0")
    .option("--cwd <path>", "workspace cwd", process.cwd())
    .option("--config <path>", "config file path");
  configureProgramOutput(program, io);

  program.addHelpText(
    "after",
    `
Examples:
  hk init --providers mock
  hk run --provider mock --task "Summarize this repo" --stream
  hk runs
  hk doctor --provider mock
  hk docs capabilities

Real provider SDKs are optional peers. The CLI includes metaharness adapters;
install only SDK peers for real providers you run, keep raw events disabled
unless debugging, and branch product logic on capabilities.
`
  );

  program
    .command("init")
    .description("create metaharness config and policy files")
    .option(
      "--providers <list>",
      `comma-separated providers: ${supportedProviderList}`,
      "mock"
    )
    .option("--ci <provider>", "create CI workflow: github")
    .option("--force", "overwrite existing generated files")
    .addHelpText(
      "after",
      `
Examples:
  hk init --providers mock
  hk init --providers codex --ci github
  hk --cwd ../my-workspace init --providers mock

Creates metaharness.config.ts, metaharness.policy.yaml, .harness/.gitignore,
and optionally .github/workflows/metaharness.yml. Existing files are not
overwritten unless --force is passed intentionally.
`
    )
    .action(async (options) => {
      await initCommand(
        {
          ...options,
          cwd: program.opts<{ cwd: string }>().cwd
        },
        io
      );
    });

  program
    .command("run")
    .description("run an agent task")
    .option(
      "--provider <provider>",
      `provider id: ${supportedProviderList}; defaults to config.defaultProvider or mock`
    )
    .option("--model <model>", "provider model")
    .option("--raw-events", "capture provider.raw events in provider/raw-events.ndjson")
    .option("--runtime <runtime>", "provider runtime: local, cloud, or self-hosted")
    .option("--repo <url>", "Cursor cloud repository URL")
    .option("--starting-ref <ref>", "Cursor cloud repository starting ref")
    .option("--pr-url <url>", "Cursor cloud pull request URL to attach")
    .option("--auto-create-pr", "Cursor cloud: create a pull request when supported")
    .option(
      "--skip-reviewer-request",
      "Cursor cloud: skip requesting the caller as reviewer"
    )
    .option("--work-on-current-branch", "Cursor cloud: push to current branch")
    .option("--task <task>", "inline task prompt")
    .option("--task-file <path>", "task prompt file, resolved relative to --cwd")
    .option(
      "--verify <command>",
      "verification command; repeat for multiple commands",
      collectVerify,
      []
    )
    .option("--json", "print JSON result; cannot be combined with --stream")
    .option(
      "--stream",
      "print human-readable events while active; cannot be combined with --json"
    )
    .addHelpText(
      "after",
      `
Examples:
  hk run --provider mock --task "Summarize this repo" --stream
  hk run --provider codex --task-file task.md --verify "pnpm test"
  hk runs
  hk ledger show latest

Run hk doctor --provider <provider> before live provider work. After a run,
use hk ledger show <run-id>, hk stream <run-id>, or the latest alias to inspect
the generated artifacts.
`
    )
    .action(async (options) => {
      await runCommand(
        {
          ...program.opts(),
          ...options
        },
        io
      );
    });

  program
    .command("resume")
    .description("resume a provider-native session or continue from a prior run ledger")
    .option("--provider <provider>", `provider id: ${supportedProviderList}`)
    .option("--model <model>", "provider model")
    .option("--raw-events", "capture provider.raw events in provider/raw-events.ndjson")
    .option("--runtime <runtime>", "provider runtime: local, cloud, or self-hosted")
    .option("--session <native-session-id>", "provider-native session id")
    .option("--run <run-id>", "harness run id to resume from")
    .option("--task <task>", "inline task prompt")
    .option("--task-file <path>", "task prompt file, resolved relative to --cwd")
    .option(
      "--verify <command>",
      "verification command; repeat for multiple commands",
      collectVerify,
      []
    )
    .option("--json", "print JSON result; cannot be combined with --stream")
    .option(
      "--stream",
      "print human-readable events while active; cannot be combined with --json"
    )
    .addHelpText(
      "after",
      `
Examples:
  hk resume --provider codex --session <native-session-id> --task "Continue"
  hk resume --run <run-id> --provider mock --task "Continue from the ledger"

Use --session for same-provider native continuation when a provider exposes a
native session id. Use --run when continuing from a metaharness ledger.
`
    )
    .action(async (options) => {
      await resumeCommand({ ...program.opts(), ...options }, io);
    });

  program
    .command("handoff")
    .description(
      "continue a prior run with another provider using ledger and diff context"
    )
    .option("--from-run <run-id>", "source run id (required)")
    .option(
      "--to <provider>",
      `destination provider id (required): ${supportedProviderList}`
    )
    .option("--instruction <text>", "additional handoff instruction")
    .option("--apply-patch", "apply the source run patch before starting destination")
    .option("--verify <command>", "verification command", collectVerify, [])
    .option("--json", "print JSON result")
    .addHelpText(
      "after",
      `
Examples:
  hk handoff --from-run <run-id> --to codex --instruction "Finish verification"
  hk handoff --from-run <run-id> --to mock --apply-patch --verify "pnpm test"
  hk ledger handoff <run-id>

Handoff uses explicit ledger, handoff prompt, diff, and verification artifacts.
It does not transfer hidden provider-native session state.
`
    )
    .action(async (options) => {
      await handoffCommand({ ...program.opts(), ...options }, io);
    });

  program
    .command("compare")
    .description("run the same task across providers and write compare artifacts")
    .option(
      "--providers <list>",
      `comma-separated provider ids: ${supportedProviderList}`,
      "mock"
    )
    .option("--task <task>", "inline task prompt")
    .option("--task-file <path>", "task prompt file")
    .option("--verify <command>", "verification command", collectVerify, [])
    .option("--isolated-worktrees", "run each provider in an isolated git worktree")
    .option("--max-concurrency <count>", "maximum compare runs to execute at once")
    .option("--json", "print JSON result")
    .addHelpText(
      "after",
      `
Examples:
  hk compare --providers mock,codex --task "Find the safest fix"
  hk compare --providers mock --task-file task.md --verify "pnpm test"
  hk ledger show <run-id>

Compare writes .harness/compares/<compare-id>/compare.md and includes a run id
for each provider result. Inspect the chosen provider run with hk ledger show
<run-id> or hk stream <run-id>.
`
    )
    .action(async (options) => {
      await compareCommand({ ...program.opts(), ...options }, io);
    });

  program
    .command("runs")
    .description("list recent run artifacts")
    .option("--limit <count>", "maximum runs to list", "10")
    .option("--json", "print JSON run list")
    .addHelpText(
      "after",
      `
Examples:
  hk runs
  hk runs --limit 5
  hk runs --json

Use the printed run id with hk ledger show <run-id> or hk stream <run-id>.
Use latest when you want the most recent run under the active workspace.
Artifact commands resolve runs from --cwd, --config, and storage.rootDir; keep
those options the same when using latest or inspecting a prior run.
`
    )
    .action(async (options) => {
      await runsCommand({ ...program.opts(), ...options }, io);
    });

  program
    .command("stream")
    .description("print events for a run")
    .argument("[run-id]", "run id or latest alias (required)")
    .option("--raw", "read raw provider event log")
    .addHelpText(
      "after",
      `
Examples:
  hk stream latest
  hk stream <run-id>
  hk stream <run-id> --raw

Streams normalized portable events by default. --raw reads provider raw events
only when raw capture was enabled for the run. Run lookup uses --cwd, --config,
and storage.rootDir; keep those options the same when using latest or inspecting
a prior run.
`
    )
    .action(async (runId, options) => {
      await streamCommand(runId, { ...program.opts(), ...options }, io);
    });

  program
    .command("doctor")
    .description("check local metaharness setup")
    .option(
      "--provider <provider>",
      `provider id: ${supportedProviderList}; defaults to config.defaultProvider or mock`
    )
    .option("--all", "include all providers")
    .option("--json", "print JSON report")
    .addHelpText(
      "after",
      `
Examples:
  hk doctor --provider mock
  hk doctor --provider codex
  hk doctor --all
  hk doctor --provider mock --json

Use --provider for the provider you are about to run. Use --all only when every
configured provider is intentionally installed and authenticated.
`
    )
    .action(async (options) => {
      await doctorCommand({ ...program.opts(), ...options }, io);
    });

  const docs = program.command("docs").description("documentation helpers");
  docs
    .command("capabilities")
    .description("render provider capability matrix markdown")
    .option("--json", "print JSON capabilities")
    .addHelpText(
      "after",
      `
Examples:
  hk docs capabilities
  hk docs capabilities --json

Renders the ProviderCapabilities matrix returned by installed adapters. The
markdown output reminds application code to branch on capability flags, not
provider strings.
`
    )
    .action(async (options) => {
      await docsCapabilitiesCommand({ ...program.opts(), ...options }, io);
    });

  const policy = program.command("policy").description("policy commands");
  policy
    .command("check")
    .description("validate policy")
    .option("--policy-file <path>", "policy file path", "metaharness.policy.yaml")
    .option(
      "--provider <provider>",
      `include provider warnings: ${supportedProviderList}`
    )
    .option("--json", "print JSON diagnostics")
    .addHelpText(
      "after",
      `
Examples:
  hk policy check
  hk policy check --provider codex
  hk policy check --policy-file metaharness.policy.yaml --provider codex --json

Validates policy syntax and portable metaharness rules. Add --provider when you
want provider-specific warnings for the provider you are about to run.
`
    )
    .action(async (options) => {
      await policyCheckCommand({ ...program.opts(), ...options }, io);
    });
  policy
    .command("compile")
    .description("compile policy to provider-native hints and harness guards")
    .option("--provider <provider>", `provider id (required): ${supportedProviderList}`)
    .option("--policy-file <path>", "policy file path", "metaharness.policy.yaml")
    .option("--json", "print JSON compiled policy")
    .addHelpText(
      "after",
      `
Examples:
  hk policy compile --provider codex
  hk policy compile --provider codex --json

Requires --provider. Prints the provider-native policy hints plus portable
harness guards. Provider warnings are advisory; policy is defense in depth, not
a complete sandbox boundary.
`
    )
    .action(async (options) => {
      await policyCompileCommand({ ...program.opts(), ...options }, io);
    });

  const ledger = program.command("ledger").description("ledger commands");
  ledger
    .command("show")
    .description("show a concise run ledger summary")
    .argument("[run-id]", "run id or latest alias (required)")
    .option("--json", "print JSON ledger")
    .addHelpText(
      "after",
      `
Examples:
  hk ledger show latest
  hk ledger show <run-id>
  hk ledger show <run-id> --json

Shows artifact paths for events, result, ledger, handoff prompt, patch,
verification log, raw-event status, changed files, and verification outcomes.
Run lookup uses --cwd, --config, and storage.rootDir; keep those options the
same when using latest or inspecting a prior run.
`
    )
    .action(async (runId, options) => {
      await ledgerShowCommand(runId, { ...program.opts(), ...options }, io);
    });
  ledger
    .command("export")
    .description("export a portable session ledger")
    .argument("[run-id]", "run id or latest alias (required)")
    .option("--out <path>", "output path, resolved relative to --cwd")
    .addHelpText(
      "after",
      `
Examples:
  hk ledger export latest
  hk ledger export <run-id>
  hk ledger export <run-id> --out ledger.json

Writes the portable SessionLedger JSON for a run. Without --out, prints JSON to
stdout. With --out, relative paths resolve from --cwd and parent directories are
created when needed. Run lookup uses --cwd, --config, and storage.rootDir; keep
those options the same when using latest or inspecting a prior run.
`
    )
    .action(async (runId, options) => {
      await ledgerExportCommand(runId, { ...program.opts(), ...options }, io);
    });
  ledger
    .command("handoff")
    .description("render a handoff prompt for a run")
    .argument("[run-id]", "run id or latest alias (required)")
    .option("--out <path>", "output path, resolved relative to --cwd")
    .addHelpText(
      "after",
      `
Examples:
  hk ledger handoff latest
  hk ledger handoff <run-id>
  hk ledger handoff <run-id> --out handoff.md
  hk handoff --from-run <run-id> --to codex

Renders the explicit handoff prompt from the run ledger. It does not resume or
transfer hidden provider-native session state; use hk handoff to start a
destination run. Run lookup uses --cwd, --config, and storage.rootDir; keep
those options the same when using latest or inspecting a prior run.
`
    )
    .action(async (runId, options) => {
      await ledgerHandoffCommand(runId, { ...program.opts(), ...options }, io);
    });

  program.exitOverride();
  configureProgramOutput(program, io);
  return program;
}

export async function runCli(
  argv = process.argv,
  io: CliIO = defaultIO()
): Promise<void> {
  const program = createProgram(io);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      return;
    }
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      return;
    }
    io.stderr.write(`error: ${formatCliError(error)}\n`);
    process.exitCode = 1;
    return;
  } finally {
    await shutdownCliTelemetry();
  }
}

function formatCliError(error: unknown): string {
  if (error instanceof HarnessError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function configureProgramOutput(program: Command, io: CliIO): void {
  program.configureOutput({
    outputError: (message, write) => write(formatCommanderOutputError(message)),
    writeErr: (message) => io.stderr.write(message),
    writeOut: (message) => io.stdout.write(message)
  });
}

function formatCommanderOutputError(message: string): string {
  const trimmed = message.trimEnd();
  const detail = trimmed.replace(/^error:\s*/, "");
  return `error: ${commanderUsageErrorCode}: ${detail}\n`;
}

function defaultIO(): CliIO {
  return {
    stderr: process.stderr,
    stdout: process.stdout
  };
}
