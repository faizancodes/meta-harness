import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hk = resolve(repoRoot, "packages/cli/dist/index.js");

const workspaces = [];

try {
  await smokeInit();
  await smokeRunLedgerAndCompare();
  await smokeSdkExample();
  console.log("Credential-free examples smoke passed.");
} finally {
  await Promise.all(
    workspaces.map((workspace) =>
      rm(workspace, {
        force: true,
        recursive: true
      })
    )
  );
}

async function smokeInit() {
  const cwd = await tempWorkspace("metaharness-example-init-");
  const output = await runHk([
    "--cwd",
    cwd,
    "init",
    "--providers",
    "mock",
    "--ci",
    "github"
  ]);

  assertIncludes(output.stdout, "Created:", "init should list created files");
  await assertReadable(join(cwd, "metaharness.config.ts"));
  await assertReadable(join(cwd, "metaharness.policy.yaml"));
  await assertReadable(join(cwd, ".github/workflows/metaharness.yml"));

  await runHk(["--cwd", cwd, "doctor", "--provider", "mock"]);
  const run = await runHk([
    "--cwd",
    cwd,
    "run",
    "--provider",
    "mock",
    "--task",
    "Smoke test the generated metaharness config.",
    "--json"
  ]);
  const result = JSON.parse(run.stdout);
  if (!result.runId || result.status !== "success") {
    throw new Error(`Expected generated config run to succeed, got ${run.stdout}`);
  }
}

async function smokeRunLedgerAndCompare() {
  const cwd = await tempWorkspace("metaharness-example-run-");
  await writeFile(
    join(cwd, "task.md"),
    "Use the mock provider to summarize this temporary workspace.\n",
    "utf8"
  );

  await runHk(["--cwd", cwd, "doctor", "--provider", "mock"]);

  const run = await runHk([
    "--cwd",
    cwd,
    "run",
    "--provider",
    "mock",
    "--task-file",
    "task.md",
    "--verify",
    "node --version",
    "--json"
  ]);
  const result = JSON.parse(run.stdout);
  if (!result.runId || result.status !== "success") {
    throw new Error(`Expected successful mock run JSON, got ${run.stdout}`);
  }

  const runs = await runHk(["--cwd", cwd, "runs"]);
  assertIncludes(runs.stdout, result.runId, "runs should list the recent run id");

  const stream = await runHk(["--cwd", cwd, "stream", result.runId]);
  assertIncludes(stream.stdout, "run started", "stream should replay run events");

  const ledger = await runHk(["--cwd", cwd, "ledger", "show", result.runId]);
  assertIncludes(ledger.stdout, "status success", "ledger show should summarize run");
  assertIncludes(
    ledger.stdout,
    "verification",
    "ledger show should include verification"
  );

  const handoff = await runHk(["--cwd", cwd, "ledger", "handoff", result.runId]);
  assertIncludes(
    handoff.stdout,
    "metaharness handoff",
    "ledger handoff should render handoff markdown"
  );

  const compare = await runHk([
    "--cwd",
    cwd,
    "compare",
    "--providers",
    "mock",
    "--task-file",
    "task.md",
    "--verify",
    "node --version"
  ]);
  assertIncludes(compare.stdout, "compare compare-", "compare should write artifacts");
  assertIncludes(
    compare.stdout,
    "provider\tstatus\tverify\trun id\tpatch",
    "compare should print run ids in human output"
  );
  assertIncludes(
    compare.stdout,
    "mock\tsuccess\tverify:pass\tmock-run-",
    "compare should map each provider result to a run id"
  );
  assertIncludes(compare.stdout, "next", "compare should print next steps");
  assertIncludes(
    compare.stdout,
    "hk ledger show <run-id>",
    "compare next steps should point at ledger inspection"
  );
  assertIncludes(
    compare.stdout,
    "hk stream <run-id>",
    "compare next steps should point at stream replay"
  );
  const compareMarkdownPath = lineValue(compare.stdout, "markdown ");
  assertIncludes(
    compare.stdout,
    `review markdown ${compareMarkdownPath}`,
    "compare next steps should point at the markdown report"
  );
  const compareMarkdown = await readFile(compareMarkdownPath, "utf8");
  assertIncludes(
    compareMarkdown,
    "provider | run id | status | verify",
    "compare markdown should include run ids"
  );
  assertIncludes(
    compareMarkdown,
    "mock | mock-run-",
    "compare markdown should map provider results to run ids"
  );
}

async function smokeSdkExample() {
  const result = await execFileAsync(
    process.execPath,
    [resolve(repoRoot, "examples/sdk-basic/index.mjs")],
    {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024
    }
  );
  assertIncludes(result.stdout, "status success", "SDK example should finish a run");
  assertIncludes(result.stdout, "ledger ", "SDK example should print ledger path");
}

async function tempWorkspace(prefix) {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  workspaces.push(workspace);
  return workspace;
}

async function runHk(args) {
  return execFileAsync(process.execPath, [hk, ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024
  });
}

async function assertReadable(path) {
  await readFile(path, "utf8");
}

function assertIncludes(value, expected, message) {
  if (!value.includes(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)} in:\n${value}`);
  }
}

function lineValue(output, prefix) {
  const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith(prefix));
  if (!line) {
    throw new Error(
      `Expected line starting with ${JSON.stringify(prefix)} in:\n${output}`
    );
  }
  return line.slice(prefix.length).trim();
}
