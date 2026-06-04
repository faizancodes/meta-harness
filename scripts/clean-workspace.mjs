import { readdir, rm, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const ignoredDirectoryNames = new Set([
  ".git",
  ".harness",
  "coverage",
  "dist",
  "node_modules"
]);
const fixedTargets = [
  "coverage",
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
  console.error(`Unknown cleanup option: ${unknownArgs.join(", ")}`);
  console.error("Run pnpm clean -- --help for usage.");
  process.exit(1);
}

const targets = await collectTargets();

if (wantsDryRun) {
  console.log("metaharness workspace cleanup dry run");
  printSensitiveArtifactWarning();
  console.log("Run pnpm clean -- --yes to delete existing targets.");
  console.log("");
  printTargets(targets);
  process.exit(0);
}

console.log("Deleting ignored local metaharness outputs:");
let deletedCount = 0;
for (const target of targets) {
  if (!target.exists) {
    continue;
  }
  await rm(target.absolutePath, { force: true, recursive: true });
  deletedCount += 1;
  console.log(`  deleted ${target.path}`);
}

if (deletedCount === 0) {
  console.log("  no ignored local outputs found");
}

async function collectTargets() {
  const fixed = await Promise.all(fixedTargets.map(targetState));
  const packageDistTargets = await collectPackageDistTargets();
  const tsBuildInfoTargets = await collectTsBuildInfoTargets(repoRoot);

  return [...packageDistTargets, ...fixed, ...tsBuildInfoTargets].sort((left, right) =>
    left.path.localeCompare(right.path)
  );
}

async function collectPackageDistTargets() {
  const packagesRoot = resolveSafeTarget("packages");
  if (!(await pathExists(packagesRoot))) {
    return [];
  }

  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const packageDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `packages/${entry.name}/dist`)
    .sort();
  return Promise.all(packageDirs.map(targetState));
}

async function collectTsBuildInfoTargets(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const targets = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(repoRoot, absolutePath);
    if (entry.isDirectory()) {
      if (ignoredDirectoryNames.has(entry.name)) {
        continue;
      }
      targets.push(...(await collectTsBuildInfoTargets(absolutePath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
      targets.push(await targetState(relativePath));
    }
  }

  return targets;
}

async function targetState(target) {
  const absolutePath = resolveSafeTarget(target);
  return {
    absolutePath,
    exists: await pathExists(absolutePath),
    path: normalizePath(relative(repoRoot, absolutePath))
  };
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

function normalizePath(path) {
  return path.split(sep).join("/");
}

function printTargets(targets) {
  for (const target of targets) {
    console.log(`  ${target.exists ? "found  " : "missing"} ${target.path}`);
  }
}

function printUsage() {
  console.log("Usage: pnpm clean -- [--dry-run|--yes]");
  console.log("");
  console.log("Inspects or deletes ignored local metaharness outputs.");
  console.log("Dry-run is the default; deletion requires --yes.");
  printSensitiveArtifactWarning();
  console.log("");
  console.log("Targets:");
  console.log("  package dist directories");
  console.log("  coverage directories");
  console.log("  *.tsbuildinfo files");
  console.log("  .harness run, compare, worktree, handoff, and task artifacts");
  console.log("");
  console.log("Examples:");
  console.log("  pnpm clean -- --dry-run");
  console.log("  pnpm clean -- --yes");
}

function printSensitiveArtifactWarning() {
  console.log(
    "Local .harness artifacts can contain prompts, transcripts, diffs, command summaries, and provider metadata."
  );
}
