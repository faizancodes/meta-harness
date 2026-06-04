import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hk = resolve(repoRoot, "packages/cli/dist/index.js");
const failures = [];

await access(hk).catch(() => {
  failures.push("packages/cli/dist/index.js is missing. Run pnpm build first.");
});

if (failures.length === 0) {
  for (const helpCase of helpCases()) {
    await checkHelp(helpCase);
  }
}

if (failures.length > 0) {
  throw new Error(`CLI help check failed:\n- ${failures.join("\n- ")}`);
}

console.log("CLI help output is discoverable for all commands.");

async function checkHelp(helpCase) {
  const args = [...helpCase.args, "--help"];
  let result;

  try {
    result = await execFile(process.execPath, [hk, ...args], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    const processError = error;
    failures.push(
      `${formatCommand(args)} exited nonzero: ${[
        processError.stdout?.trim(),
        processError.stderr?.trim(),
        processError instanceof Error ? processError.message : String(processError)
      ]
        .filter(Boolean)
        .join("; ")}`
    );
    return;
  }

  const output = `${result.stdout}${result.stderr}`;
  expectIncludes(helpCase, output, `Usage: hk${helpCase.usageSuffix}`);
  expectIncludes(helpCase, output, "Options:");
  expectDoesNotInclude(helpCase, output, "undefined");
  expectDoesNotInclude(helpCase, output, "ANTHROPIC_API_KEY=");
  expectDoesNotInclude(helpCase, output, "CURSOR_API_KEY=");
  expectDoesNotInclude(helpCase, output, "OPENAI_API_KEY=");

  for (const expected of helpCase.includes) {
    expectIncludes(helpCase, output, expected);
  }

  for (const forbidden of helpCase.excludes ?? []) {
    expectDoesNotInclude(helpCase, output, forbidden);
  }
}

function helpCases() {
  return [
    {
      args: [],
      includes: [
        "Commands:",
        "init [options]",
        "run [options]",
        "resume [options]",
        "handoff [options]",
        "compare [options]",
        "runs [options]",
        "stream [options] [run-id]",
        "doctor [options]",
        "docs",
        "policy",
        "ledger",
        "The CLI includes metaharness adapters",
        "install only SDK peers for real providers",
        "branch product logic on capabilities"
      ],
      usageSuffix: " [options] [command]"
    },
    {
      args: ["init"],
      includes: [
        "--providers <list>",
        "--ci <provider>",
        "--force",
        "hk init --providers mock",
        "hk init --providers codex --ci github",
        "metaharness.config.ts",
        "Existing files are not",
        "overwritten unless --force"
      ],
      usageSuffix: " init [options]"
    },
    {
      args: ["run"],
      includes: [
        "--provider <provider>",
        "config.defaultProvider or mock",
        "--raw-events",
        "--runtime <runtime>",
        "--task <task>",
        "--task-file <path>",
        "--verify <command>",
        "--json",
        "--stream",
        'hk run --provider mock --task "Summarize this repo" --stream',
        "hk ledger show latest",
        "Run hk doctor --provider <provider> before live provider work",
        "use hk ledger show <run-id>, hk stream <run-id>"
      ],
      usageSuffix: " run [options]"
    },
    {
      args: ["resume"],
      includes: [
        "--provider <provider>",
        "--session <native-session-id>",
        "--run <run-id>",
        "--task <task>",
        "--task-file <path>",
        "--json",
        "--stream",
        "hk resume --provider codex --session <native-session-id>",
        "Use --session for same-provider native continuation",
        "Use --run when continuing from a metaharness ledger"
      ],
      usageSuffix: " resume [options]"
    },
    {
      args: ["handoff"],
      includes: [
        "--from-run <run-id>",
        "--to <provider>",
        "--instruction <text>",
        "--apply-patch",
        "--verify <command>",
        "--json",
        "hk handoff --from-run <run-id> --to codex",
        "hk ledger handoff <run-id>",
        "does not transfer hidden provider-native session state"
      ],
      usageSuffix: " handoff [options]"
    },
    {
      args: ["compare"],
      includes: [
        "--providers <list>",
        "--task <task>",
        "--task-file <path>",
        "--verify <command>",
        "--isolated-worktrees",
        "--max-concurrency <count>",
        "--json",
        "hk compare --providers mock,codex",
        ".harness/compares/<compare-id>/compare.md",
        "for each provider result",
        "hk stream <run-id>"
      ],
      usageSuffix: " compare [options]"
    },
    {
      args: ["runs"],
      includes: [
        "--limit <count>",
        "--json",
        "list recent run artifacts",
        "maximum runs to list",
        "hk runs --limit 5",
        "hk ledger show <run-id>",
        "Use latest when you want the most recent run",
        "Artifact commands resolve runs from --cwd, --config, and storage.rootDir",
        "same when using latest or inspecting a prior run"
      ],
      usageSuffix: " runs [options]"
    },
    {
      args: ["stream"],
      includes: [
        "[run-id]",
        "run id or latest alias (required)",
        "--raw",
        "hk stream latest",
        "hk stream <run-id> --raw",
        "Streams normalized portable events by default",
        "raw capture was enabled",
        "Run lookup uses --cwd, --config,",
        "same when using latest or inspecting"
      ],
      usageSuffix: " stream [options] [run-id]"
    },
    {
      args: ["doctor"],
      includes: [
        "--provider <provider>",
        "config.defaultProvider or mock",
        "--all",
        "--json",
        "hk doctor --provider mock",
        "hk doctor --all",
        "Use --provider for the provider you are about to run",
        "configured provider is intentionally installed"
      ],
      usageSuffix: " doctor [options]"
    },
    {
      args: ["docs"],
      includes: ["Commands:", "capabilities [options]"],
      usageSuffix: " docs [options] [command]"
    },
    {
      args: ["docs", "capabilities"],
      includes: [
        "--json",
        "render provider capability matrix markdown",
        "hk docs capabilities --json",
        "ProviderCapabilities matrix returned by installed adapters",
        "branch on capability flags, not",
        "provider strings"
      ],
      usageSuffix: " docs capabilities [options]"
    },
    {
      args: ["policy"],
      includes: [
        "Commands:",
        "check [options]",
        "validate policy",
        "compile [options]",
        "compile policy to provider-native hints"
      ],
      usageSuffix: " policy [options] [command]"
    },
    {
      args: ["policy", "check"],
      includes: [
        "--policy-file <path>",
        "--provider <provider>",
        "--json",
        "hk policy check --provider codex",
        "policy check --policy-file metaharness.policy.yaml",
        "Validates policy syntax",
        "provider-specific warnings"
      ],
      usageSuffix: " policy check [options]"
    },
    {
      args: ["policy", "compile"],
      includes: [
        "--provider <provider>",
        "--policy-file <path>",
        "--json",
        "hk policy compile --provider codex",
        "Requires --provider",
        "provider-native policy hints",
        "defense in depth, not"
      ],
      usageSuffix: " policy compile [options]"
    },
    {
      args: ["ledger"],
      includes: [
        "Commands:",
        "show [options] [run-id]",
        "show a concise run ledger summary",
        "export [options] [run-id]",
        "export a portable session ledger",
        "handoff [options] [run-id]",
        "render a handoff prompt for a run"
      ],
      usageSuffix: " ledger [options] [command]"
    },
    {
      args: ["ledger", "show"],
      includes: [
        "[run-id]",
        "run id or latest alias (required)",
        "--json",
        "show a concise run ledger summary",
        "hk ledger show latest",
        "hk ledger show <run-id> --json",
        "artifact paths for events",
        "verification outcomes",
        "Run lookup uses --cwd, --config,",
        "same when using latest or inspecting"
      ],
      usageSuffix: " ledger show [options] [run-id]"
    },
    {
      args: ["ledger", "export"],
      includes: [
        "[run-id]",
        "run id or latest alias (required)",
        "--out <path>",
        "export a portable session ledger",
        "hk ledger export latest",
        "hk ledger export <run-id> --out ledger.json",
        "portable SessionLedger JSON",
        "relative paths resolve from --cwd",
        "Run lookup uses --cwd, --config,",
        "same when using latest or inspecting"
      ],
      usageSuffix: " ledger export [options] [run-id]"
    },
    {
      args: ["ledger", "handoff"],
      includes: [
        "[run-id]",
        "run id or latest alias (required)",
        "--out <path>",
        "render a handoff prompt for a run",
        "hk ledger handoff latest",
        "hk ledger handoff <run-id> --out handoff.md",
        "explicit handoff prompt from the run ledger",
        "use hk handoff to start a",
        "Run lookup uses --cwd, --config,",
        "same when using latest or inspecting"
      ],
      usageSuffix: " ledger handoff [options] [run-id]"
    }
  ];
}

function expectIncludes(helpCase, output, expected) {
  if (!output.includes(expected)) {
    failures.push(
      `${formatCommand(helpCase.args)} help should include ${JSON.stringify(expected)}.`
    );
  }
}

function expectDoesNotInclude(helpCase, output, forbidden) {
  if (output.includes(forbidden)) {
    failures.push(
      `${formatCommand(helpCase.args)} help should not include ${JSON.stringify(forbidden)}.`
    );
  }
}

function formatCommand(args) {
  return ["hk", ...args].join(" ");
}
