import { rm, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const targets = [
  ".harness/runs",
  ".harness/compares",
  ".harness/worktrees",
  ".harness/handoff-worktrees",
  ".harness/task.md"
];

const args = normalizeArgs(process.argv.slice(2));
const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsDelete = args.includes("--yes");
const wantsDryRun = args.includes("--dry-run") || !wantsDelete;
const unknownArgs = args.filter(
  (arg) => !["--help", "-h", "--yes", "--dry-run"].includes(arg)
);

if (wantsHelp) {
  printUsage();
  process.exit(0);
}

if (unknownArgs.length > 0) {
  console.error(`Unknown artifacts cleanup option: ${unknownArgs.join(", ")}`);
  console.error("Run pnpm artifacts:clean -- --help for usage.");
  process.exit(1);
}

const existingTargets = [];
for (const target of targets) {
  const absolutePath = resolveSafeTarget(target);
  const exists = await pathExists(absolutePath);
  existingTargets.push({ absolutePath, exists, target });
}

if (wantsDryRun) {
  console.log("metaharness artifact cleanup dry run");
  printSensitiveArtifactWarning();
  console.log("Run pnpm artifacts:clean -- --yes to delete existing targets.");
  console.log("");
  printTargets(existingTargets);
  process.exit(0);
}

console.log("Deleting local metaharness artifacts:");
let deletedCount = 0;
for (const target of existingTargets) {
  if (!target.exists) {
    continue;
  }
  await rm(target.absolutePath, { force: true, recursive: true });
  deletedCount += 1;
  console.log(`  deleted ${target.target}`);
}

if (deletedCount === 0) {
  console.log("  no local artifact targets found");
}

function normalizeArgs(rawArgs) {
  return rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
}

function resolveSafeTarget(target) {
  const absolutePath = resolve(repoRoot, target);
  const relativePath = relative(repoRoot, absolutePath);
  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    relativePath.split(sep).includes("..")
  ) {
    throw new Error(`Refusing to clean target outside repo root: ${target}`);
  }
  return absolutePath;
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function printTargets(targetsWithState) {
  for (const target of targetsWithState) {
    console.log(`  ${target.exists ? "found  " : "missing"} ${target.target}`);
  }
}

function printUsage() {
  console.log("Usage: pnpm artifacts:clean -- [--dry-run|--yes]");
  console.log("");
  console.log("Inspects or deletes ignored local metaharness artifacts.");
  console.log("Dry-run is the default; deletion requires --yes.");
  printSensitiveArtifactWarning();
  console.log("");
  console.log("Targets:");
  for (const target of targets) {
    console.log(`  ${target}`);
  }
  console.log("");
  console.log("Examples:");
  console.log("  pnpm artifacts:clean -- --dry-run");
  console.log("  pnpm artifacts:clean -- --yes");
}

function printSensitiveArtifactWarning() {
  console.log(
    "Local .harness artifacts can contain prompts, transcripts, diffs, command summaries, and provider metadata."
  );
}
