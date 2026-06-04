import { spawn } from "node:child_process";

const liveGates = [
  {
    apiKeyEnv: "ANTHROPIC_API_KEY",
    flag: "metaharness_TEST_CLAUDE",
    label: "Claude Agent SDK",
    testName: "claude"
  },
  {
    apiKeyEnv: "CURSOR_API_KEY",
    flag: "metaharness_TEST_CURSOR",
    label: "Cursor SDK",
    testName: "cursor"
  },
  {
    apiKeyEnv: "OPENAI_API_KEY",
    flag: "metaharness_TEST_CODEX",
    label: "Codex SDK mode",
    testName: "codex sdk"
  },
  {
    apiKeyEnv: "OPENAI_API_KEY",
    flag: "metaharness_TEST_CODEX_APPSERVER",
    label: "Codex app-server mode",
    testName: "codex app-server"
  }
];

const enabledGates = liveGates.filter((gate) => process.env[gate.flag] === "1");
const invalidGateValues = liveGates.filter(
  (gate) => process.env[gate.flag] !== undefined && process.env[gate.flag] !== "1"
);
const vitestArgs = normalizeVitestArgs(process.argv.slice(2));

if (vitestArgs.includes("--help") || vitestArgs.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (enabledGates.length === 0) {
  console.error("No live provider gates are enabled.");
  if (invalidGateValues.length > 0) {
    console.error("");
    console.error("Ignored live provider gates; set gate values to exactly 1:");
    for (const gate of invalidGateValues) {
      console.error(`  ${gate.flag}=${process.env[gate.flag]}`);
    }
  }
  console.error("");
  console.error("Enable at least one live provider gate before running pnpm test:live:");
  for (const gate of liveGates) {
    console.error(
      `  ${gate.apiKeyEnv}=... ${gate.flag}=1 pnpm test:live -- -t ${JSON.stringify(
        gate.testName
      )}`
    );
  }
  console.error("");
  console.error("Use pnpm test:integration for mock-only integration conformance.");
  process.exitCode = 1;
} else {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(
    pnpm,
    ["exec", "vitest", "run", "--project", "integration", ...vitestArgs],
    {
      env: process.env,
      stdio: "inherit"
    }
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`Live conformance exited from signal ${signal}.`);
      process.exitCode = 1;
      return;
    }
    process.exitCode = code ?? 1;
  });

  child.on("error", (error) => {
    console.error(`Failed to start live conformance: ${error.message}`);
    process.exitCode = 1;
  });
}

function normalizeVitestArgs(args) {
  return args[0] === "--" ? args.slice(1) : args;
}

function printUsage() {
  console.log("Usage: pnpm test:live -- [vitest filters...]");
  console.log("");
  console.log(
    "Runs the integration Vitest project with at least one live provider gate enabled."
  );
  console.log("Gate values must be exactly 1.");
  console.log("");
  console.log("Provider gates:");
  for (const gate of liveGates) {
    console.log(`  ${gate.label}: ${gate.apiKeyEnv}=... ${gate.flag}=1`);
  }
  console.log("");
  console.log("Examples:");
  for (const gate of liveGates) {
    console.log(
      `  ${gate.apiKeyEnv}=... ${gate.flag}=1 pnpm test:live -- -t ${JSON.stringify(
        gate.testName
      )}`
    );
  }
  console.log("");
  console.log("Use pnpm test:integration for mock-only integration conformance.");
}
