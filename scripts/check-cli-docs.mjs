import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliDocsPath = resolve(repoRoot, "docs/cli.md");
const source = await readFile(cliDocsPath, "utf8");
const sections = markdownSections(source);
const failures = [];

expectSection("Global Options", [
  "--cwd <path>",
  "--config <path>",
  "pnpm --silent hk ... --json",
  "Do not combine `--json` and `--stream`",
  "CLI_USAGE_ERROR"
]);
expectSection("Initialize", [
  'WORKDIR="$(mktemp -d)"',
  'pnpm hk --cwd "$WORKDIR" init --providers mock',
  'WORKDIR="/path/to/workspace"',
  'pnpm hk --cwd "$WORKDIR" init --providers codex --ci github',
  'pnpm hk --cwd "$WORKDIR" doctor --provider mock',
  'pnpm hk --cwd "$WORKDIR" run --provider mock --task "Summarize this workspace"',
  'pnpm hk --cwd "$WORKDIR" ledger show latest',
  'Keep the same `--cwd "$WORKDIR"`',
  "storage, and `latest` resolve inside the initialized workspace",
  "--force",
  "metaharness.config.ts",
  "metaharness.policy.yaml",
  ".harness/.gitignore",
  ".github/workflows/metaharness.yml",
  "pnpm exec hk",
  "@metaharness/cli",
  "already includes the metaharness adapter",
  "provider SDK optional peers",
  "commented mock-first starting points",
  ".harness` sensitivity",
  "raw event",
  "debugging",
  "policy allow-list review"
]);
expectSection("Doctor", [
  "pnpm hk doctor --provider mock",
  "pnpm hk doctor --provider codex",
  "pnpm hk doctor --all",
  "pnpm --silent hk doctor --provider codex --json",
  "defaultProvider",
  "warning or failure has an obvious setup action",
  "provider SDK package installed",
  "<provider> adapter registered",
  "DOCTOR_CHECKS_FAILED"
]);
expectSection("Run", [
  "--provider <provider>",
  "defaultProvider",
  "--model <model>",
  "--runtime <runtime>",
  "--task <task>",
  "--task-file <path>",
  "--verify <command>",
  "--stream",
  "--json",
  "--raw-events",
  "--repo",
  "--starting-ref",
  "--auto-create-pr",
  "next",
  "hk ledger show <run-id>",
  "hk stream <run-id>",
  "hk ledger handoff <run-id>",
  "hk runs",
  "RUN_RESULT_FAILED"
]);
expectSection("Runs", [
  "pnpm hk runs",
  "pnpm hk runs --limit 5",
  "pnpm --silent hk runs --json",
  "--limit <count>",
  "--json",
  "hk ledger show latest",
  "hk stream latest",
  "hk ledger handoff latest",
  "hk runs --json",
  "active `--cwd`, `--config`, and `storage.rootDir`",
  "Keep the same `--cwd` and `--config`",
  "latest",
  "NUMERIC_OPTION_INVALID"
]);
expectSection("Resume", [
  "--provider <provider>",
  "--model <model>",
  "--runtime <runtime>",
  "--session <native-session-id>",
  "--run <run-id>",
  "--task <task>",
  "--task-file <path>",
  "--verify <command>",
  "--raw-events",
  "--json",
  "--stream",
  "next",
  "hk ledger show <run-id>",
  "hk stream <run-id>",
  "hk ledger handoff <run-id>",
  "hk runs",
  "RUN_RESULT_FAILED"
]);
expectSection("Artifacts And Ledger", [
  "events.ndjson",
  "result.json",
  "ledger.json",
  "handoff.md",
  "diff.patch",
  "verification.log",
  "provider/raw-events.ndjson",
  "pnpm hk ledger show <run-id>",
  "pnpm hk ledger show latest",
  "next",
  "hk stream <run-id>",
  "hk ledger export <run-id> --out ledger.json",
  "hk ledger handoff <run-id>",
  "hk runs",
  "pnpm hk ledger export <run-id> --out ledger.json",
  "pnpm hk ledger handoff <run-id>",
  "pnpm hk stream <run-id>",
  "pnpm hk stream latest",
  "active `--cwd`, `--config`, and `storage.rootDir`",
  "Keep those options the same",
  "latest",
  "--raw"
]);
expectSection("Handoff", [
  "--from-run <run-id>",
  "--to <provider>",
  "--instruction <text>",
  "--apply-patch",
  "--verify <command>",
  "--json",
  "next",
  "hk ledger show <run-id>",
  "hk stream <run-id>",
  "hk ledger handoff <run-id>",
  "hk runs",
  "hidden provider-native session state"
]);
expectSection("Compare", [
  "--providers <list>",
  "--task <task>",
  "--task-file <path>",
  "--verify <command>",
  "--isolated-worktrees",
  "--max-concurrency <count>",
  "--json",
  "run id",
  "next",
  "hk ledger show <run-id>",
  "hk stream <run-id>",
  "hk runs",
  "COMPARE_FAILED"
]);
expectSection("Policy", [
  "--policy-file <path>",
  "--provider <provider>",
  "--json",
  "pnpm hk policy check",
  "pnpm --silent hk policy compile --provider codex --json"
]);
expectSection("Generated Docs", [
  "pnpm hk docs capabilities",
  "pnpm --silent hk docs capabilities --json",
  "pnpm generated:check",
  "pnpm generated:write",
  "pnpm docs:capabilities"
]);
await checkCliMarkdownExamples();

if (failures.length > 0) {
  throw new Error(`CLI documentation check failed:\n- ${failures.join("\n- ")}`);
}

console.log("CLI documentation matches the current command surface and JSON guidance.");

function expectSection(heading, expectedTexts) {
  const section = sections.get(heading);
  if (!section) {
    failures.push(`docs/cli.md should include a ## ${heading} section.`);
    return;
  }

  for (const expectedText of expectedTexts) {
    if (!section.includes(expectedText)) {
      failures.push(
        `docs/cli.md ## ${heading} should mention ${JSON.stringify(expectedText)}.`
      );
    }
  }
}

function markdownSections(markdown) {
  const found = new Map();
  let currentHeading;
  let currentLines = [];

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading?.[1]) {
      if (currentHeading) {
        found.set(currentHeading, currentLines.join("\n"));
      }
      currentHeading = heading[1];
      currentLines = [line];
      continue;
    }

    if (currentHeading) {
      currentLines.push(line);
    }
  }

  if (currentHeading) {
    found.set(currentHeading, currentLines.join("\n"));
  }

  return found;
}

async function checkCliMarkdownExamples() {
  for (const markdownPath of await markdownSourcePaths()) {
    const markdown = await readFile(markdownPath, "utf8");
    for (const block of fencedBashBlocks(markdown)) {
      for (const command of logicalBashCommands(block.lines)) {
        if (usesBareHkCommand(command.text)) {
          failures.push(
            `${formatPath(markdownPath)}:${block.line + command.lineOffset} uses ${JSON.stringify(
              command.text
            )}. Use pnpm hk in public repo docs so commands work from a fresh clone.`
          );
        }
        if (requiresSilentPnpm(command.text) && !usesSilentPnpm(command.text)) {
          failures.push(
            `${formatPath(markdownPath)}:${block.line + command.lineOffset} uses ${JSON.stringify(
              command.text
            )}. Use pnpm --silent for hk JSON examples so stdout stays parseable.`
          );
        }
      }
    }
  }
}

async function markdownSourcePaths() {
  return [
    resolve(repoRoot, "README.md"),
    ...(await markdownFiles(resolve(repoRoot, "docs"))),
    ...(await markdownFiles(resolve(repoRoot, "examples"))),
    ...(await packageReadmes())
  ];
}

async function markdownFiles(directory) {
  const found = [];

  async function visit(currentDirectory) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const path = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        found.push(path);
      }
    }
  }

  await visit(directory);
  return found.sort();
}

async function packageReadmes() {
  const packagesRoot = resolve(repoRoot, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(packagesRoot, entry.name, "README.md"))
    .sort();
}

function fencedBashBlocks(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);
  let activeBlock;

  lines.forEach((line, index) => {
    const fence = line.trimStart().match(/^```([^\s`]*)?\s*$/);
    if (!fence) {
      activeBlock?.lines.push(line);
      return;
    }

    if (activeBlock) {
      blocks.push(activeBlock);
      activeBlock = undefined;
      return;
    }

    if (["bash", "sh"].includes(fence[1] ?? "")) {
      activeBlock = {
        line: index + 1,
        lines: []
      };
    }
  });

  return blocks;
}

function logicalBashCommands(lines) {
  const commands = [];
  let pending = "";
  let pendingLineOffset = 1;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    if (!pending) {
      pendingLineOffset = index + 1;
    }

    if (trimmed.endsWith("\\")) {
      pending += `${trimmed.slice(0, -1).trimEnd()} `;
      return;
    }

    const text = `${pending}${trimmed}`.trim();
    pending = "";
    commands.push({
      lineOffset: pendingLineOffset,
      text
    });
  });

  if (pending.trim()) {
    commands.push({
      lineOffset: pendingLineOffset,
      text: pending.trim()
    });
  }

  return commands;
}

function requiresSilentPnpm(command) {
  return command.includes("--json") && /\bpnpm\s+(?:exec\s+)?hk\b/.test(command);
}

function usesSilentPnpm(command) {
  return /\bpnpm\s+--silent\s+(?:exec\s+)?hk\b/.test(command);
}

function usesBareHkCommand(command) {
  return /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*hk\s+/.test(command);
}

function formatPath(path) {
  return relative(repoRoot, path) || ".";
}
