import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const [mode, ...rawTargets] = process.argv.slice(2);

if (mode !== "--check" && mode !== "--write") {
  console.error("Usage: node scripts/run-prettier.mjs --check|--write [paths...]");
  process.exit(1);
}

const targets = rawTargets[0] === "--" ? rawTargets.slice(1) : rawTargets;
const prettierBin = resolve(repoRoot, "node_modules/prettier/bin/prettier.cjs");

await access(prettierBin).catch(() => {
  console.error("Prettier is not installed. Run pnpm install first.");
  process.exit(1);
});

const child = spawn(
  process.execPath,
  [prettierBin, mode, ...(targets.length > 0 ? targets : ["."])],
  {
    cwd: repoRoot,
    stdio: "inherit"
  }
);

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Prettier exited from signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
