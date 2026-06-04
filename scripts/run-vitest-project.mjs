import { spawn } from "node:child_process";

const projects = [
  "core",
  "adapter-mock",
  "policy",
  "telemetry",
  "claude",
  "cursor",
  "codex",
  "cli",
  "github-action",
  "integration"
];

const args = process.argv.slice(2);
const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
const [project, ...vitestFilters] = normalizedArgs;

if (!project || project === "--help" || project === "-h") {
  printUsage(project ? 0 : 1);
}

if (!projects.includes(project)) {
  console.error(`Unknown Vitest project: ${project}`);
  console.error(`Known projects: ${projects.join(", ")}`);
  process.exit(1);
}

const child = spawn(
  "pnpm",
  ["exec", "vitest", "run", "--project", project, ...vitestFilters],
  {
    stdio: "inherit"
  }
);

child.on("error", (error) => {
  console.error(`Unable to start Vitest project ${project}: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function printUsage(exitCode) {
  console.log(`Usage: pnpm test:project -- <project> [vitest filters...]`);
  console.log("");
  console.log(`Projects: ${projects.join(", ")}`);
  console.log("");
  console.log("Examples:");
  console.log("  pnpm test:project -- cli");
  console.log("  pnpm test:project -- cli packages/cli/test/cli.test.ts");
  console.log(
    '  pnpm test:project -- cli packages/cli/test/cli.test.ts -t "run command"'
  );
  console.log("");
  console.log(
    "Use pnpm test when build output, generated artifacts, or package entrypoints matter."
  );
  process.exit(exitCode);
}
