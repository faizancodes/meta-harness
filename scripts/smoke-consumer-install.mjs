import { execFile as execFileCallback } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = resolve(repoRoot, "packages");
const tempRoot = await mkdtemp(join(tmpdir(), "metaharness-consumer-smoke-"));
const tarballRoot = resolve(tempRoot, "tarballs");
const consumerRoot = resolve(tempRoot, "consumer");
const cliOnlyConsumerRoot = resolve(tempRoot, "cli-only-consumer");

try {
  await mkdir(tarballRoot, { recursive: true });
  await mkdir(consumerRoot, { recursive: true });
  await mkdir(cliOnlyConsumerRoot, { recursive: true });

  const packages = await packPublishablePackages();
  await createConsumerProject(packages);
  await installPackedPackages();
  await smokeSdkImport();
  await smokeCliBinary();
  await smokeCliOnlyInstall(packages);

  console.log("Consumer install smoke passed with packed package tarballs.");
} finally {
  await rm(tempRoot, {
    force: true,
    recursive: true
  });
}

async function packPublishablePackages() {
  const packageDirs = await publishablePackageDirs();
  const packages = [];

  for (const packageDir of packageDirs) {
    const manifest = JSON.parse(
      await readFile(resolve(packagesRoot, packageDir, "package.json"), "utf8")
    );
    const destination = resolve(tarballRoot, packageDir);
    await mkdir(destination, { recursive: true });
    await execFile(
      "pnpm",
      [
        "--dir",
        resolve(packagesRoot, packageDir),
        "pack",
        "--pack-destination",
        destination
      ],
      {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024
      }
    );

    const packed = (await readdir(destination)).filter((file) => file.endsWith(".tgz"));
    if (packed.length !== 1) {
      throw new Error(`${packageDir} produced ${packed.length} tarballs.`);
    }

    packages.push({
      name: manifest.name,
      tarball: resolve(destination, packed[0])
    });
  }

  return packages.sort((left, right) => left.name.localeCompare(right.name));
}

async function publishablePackageDirs() {
  const entries = await readdir(packagesRoot, {
    withFileTypes: true
  });
  const packageDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = entry.name;
    const manifest = JSON.parse(
      await readFile(resolve(packagesRoot, packageDir, "package.json"), "utf8")
    );
    if (manifest.private !== true) {
      packageDirs.push(packageDir);
    }
  }

  return packageDirs.sort();
}

async function createConsumerProject(packages) {
  const dependencies = tarballDependencies(packages);
  await writeFile(
    resolve(consumerRoot, "package.json"),
    `${JSON.stringify(
      {
        dependencies,
        name: "metaharness-consumer-smoke",
        packageManager: "pnpm@9.13.0",
        pnpm: {
          overrides: dependencies
        },
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    resolve(consumerRoot, ".npmrc"),
    ["auto-install-peers=false", "engine-strict=true", ""].join("\n"),
    "utf8"
  );
}

async function createCliOnlyConsumerProject(packages) {
  const dependencies = tarballDependencies(packages);
  await writeFile(
    resolve(cliOnlyConsumerRoot, "package.json"),
    `${JSON.stringify(
      {
        dependencies: {
          "@metaharness/cli": dependencies["@metaharness/cli"]
        },
        name: "metaharness-cli-only-consumer-smoke",
        packageManager: "pnpm@9.13.0",
        pnpm: {
          overrides: dependencies
        },
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    resolve(cliOnlyConsumerRoot, ".npmrc"),
    ["auto-install-peers=false", "engine-strict=true", ""].join("\n"),
    "utf8"
  );
}

function tarballDependencies(packages) {
  return Object.fromEntries(packages.map((pack) => [pack.name, `file:${pack.tarball}`]));
}

async function installPackedPackages() {
  await execFile("pnpm", ["install", "--ignore-scripts"], {
    cwd: consumerRoot,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function smokeSdkImport() {
  const script = `
import { createHarness, defineConfig } from "@metaharness/core";
import { MockAdapter } from "@metaharness/adapter-mock";

const harness = createHarness(
  defineConfig({
    defaultProvider: "mock",
    providers: {
      mock: { provider: "mock" }
    },
    storage: {
      rootDir: ".harness",
      redactSecrets: true
    },
    workspace: {
      cwd: process.cwd()
    }
  }),
  [new MockAdapter()]
);

const result = await harness.run({
  task: "Run the downstream consumer SDK smoke."
});

if (result.status !== "success") {
  throw new Error(\`Expected success, got \${result.status}\`);
}

console.log(JSON.stringify({ runId: result.runId, status: result.status }));
`;

  const { stdout } = await execFile(
    process.execPath,
    ["--input-type=module", "-e", script],
    {
      cwd: consumerRoot,
      maxBuffer: 1024 * 1024
    }
  );
  const result = JSON.parse(stdout);
  if (!result.runId || result.status !== "success") {
    throw new Error(`Unexpected SDK smoke output: ${stdout}`);
  }
}

async function smokeCliBinary() {
  const env = {
    ...process.env,
    metaharness_OTEL_EXPORTER: "none"
  };
  const help = await execFile("pnpm", ["exec", "hk", "--help"], {
    cwd: consumerRoot,
    env,
    maxBuffer: 1024 * 1024
  });
  assertIncludes(`${help.stdout}${help.stderr}`, "Run Claude, Cursor, Codex", "CLI help");

  const doctor = await execFile(
    "pnpm",
    ["exec", "hk", "doctor", "--provider", "mock", "--json"],
    {
      cwd: consumerRoot,
      env,
      maxBuffer: 1024 * 1024
    }
  );
  const doctorReport = JSON.parse(doctor.stdout);
  if (doctorReport.ok !== true) {
    throw new Error(`Expected mock doctor to pass, got ${doctor.stdout}`);
  }

  const run = await execFile(
    "pnpm",
    [
      "exec",
      "hk",
      "run",
      "--provider",
      "mock",
      "--task",
      "Run the downstream consumer CLI smoke.",
      "--json"
    ],
    {
      cwd: consumerRoot,
      env,
      maxBuffer: 1024 * 1024
    }
  );
  const result = JSON.parse(run.stdout);
  if (!result.runId || result.status !== "success") {
    throw new Error(`Expected successful CLI run JSON, got ${run.stdout}`);
  }
  await smokeRunArtifactWorkflow({
    cwd: consumerRoot,
    env,
    expectedRunId: result.runId,
    label: "downstream consumer CLI"
  });
}

async function smokeCliOnlyInstall(packages) {
  await createCliOnlyConsumerProject(packages);
  await execFile("pnpm", ["install", "--ignore-scripts"], {
    cwd: cliOnlyConsumerRoot,
    maxBuffer: 10 * 1024 * 1024
  });

  const env = {
    ...process.env,
    metaharness_OTEL_EXPORTER: "none"
  };

  const help = await execFile("pnpm", ["exec", "hk", "--help"], {
    cwd: cliOnlyConsumerRoot,
    env,
    maxBuffer: 1024 * 1024
  });
  assertIncludes(
    `${help.stdout}${help.stderr}`,
    "Run Claude, Cursor, Codex",
    "CLI-only help"
  );

  await execFile("pnpm", ["exec", "hk", "init", "--providers", "mock"], {
    cwd: cliOnlyConsumerRoot,
    env,
    maxBuffer: 1024 * 1024
  });

  const generatedConfig = await readFile(
    resolve(cliOnlyConsumerRoot, "metaharness.config.ts"),
    "utf8"
  );
  assertIncludes(
    generatedConfig,
    'import("@metaharness/cli").HarnessConfig',
    "CLI-only generated config"
  );

  const doctor = await execFile(
    "pnpm",
    ["exec", "hk", "doctor", "--provider", "mock", "--json"],
    {
      cwd: cliOnlyConsumerRoot,
      env,
      maxBuffer: 1024 * 1024
    }
  );
  const doctorReport = JSON.parse(doctor.stdout);
  if (doctorReport.ok !== true) {
    throw new Error(`Expected CLI-only mock doctor to pass, got ${doctor.stdout}`);
  }

  const run = await execFile(
    "pnpm",
    [
      "exec",
      "hk",
      "run",
      "--provider",
      "mock",
      "--task",
      "Run the CLI-only consumer smoke.",
      "--json"
    ],
    {
      cwd: cliOnlyConsumerRoot,
      env,
      maxBuffer: 1024 * 1024
    }
  );
  const result = JSON.parse(run.stdout);
  if (!result.runId || result.status !== "success") {
    throw new Error(`Expected successful CLI-only run JSON, got ${run.stdout}`);
  }
  await smokeRunArtifactWorkflow({
    cwd: cliOnlyConsumerRoot,
    env,
    expectedRunId: result.runId,
    label: "CLI-only consumer"
  });
}

async function smokeRunArtifactWorkflow({ cwd, env, expectedRunId, label }) {
  const runs = await execFile("pnpm", ["exec", "hk", "runs", "--json"], {
    cwd,
    env,
    maxBuffer: 1024 * 1024
  });
  const runsReport = JSON.parse(runs.stdout);
  const expectedRunsRoot = await realpath(resolve(cwd, ".harness", "runs"));
  if (runsReport.runsRoot !== expectedRunsRoot) {
    throw new Error(
      `${label} runs root should be ${expectedRunsRoot}, got ${runs.stdout}`
    );
  }

  if (!Array.isArray(runsReport.runs) || runsReport.runs.length === 0) {
    throw new Error(`${label} should list at least one run, got ${runs.stdout}`);
  }

  const latest = runsReport.runs[0];
  if (latest.runId !== expectedRunId) {
    throw new Error(`${label} latest run should be ${expectedRunId}, got ${runs.stdout}`);
  }

  const listedRun = runsReport.runs.find((runEntry) => runEntry.runId === expectedRunId);
  if (!listedRun) {
    throw new Error(`${label} should list run ${expectedRunId}, got ${runs.stdout}`);
  }
  if (listedRun.status !== "success" || listedRun.provider !== "mock") {
    throw new Error(
      `${label} listed run should be a successful mock run, got ${runs.stdout}`
    );
  }

  const stream = await execFile("pnpm", ["exec", "hk", "stream", "latest"], {
    cwd,
    env,
    maxBuffer: 1024 * 1024
  });
  assertIncludes(stream.stdout, "run started", `${label} latest stream`);
  assertIncludes(stream.stdout, "run completed: success", `${label} latest stream`);

  const ledger = await execFile("pnpm", ["exec", "hk", "ledger", "show", "latest"], {
    cwd,
    env,
    maxBuffer: 1024 * 1024
  });
  assertIncludes(ledger.stdout, `run ${expectedRunId}`, `${label} latest ledger`);
  assertIncludes(ledger.stdout, "status success", `${label} latest ledger`);
  assertIncludes(ledger.stdout, "provider mock", `${label} latest ledger`);
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(
      `${label} should include ${JSON.stringify(expected)}. Got:\n${value}`
    );
  }
}
