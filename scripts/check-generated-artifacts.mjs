import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generatedArtifacts, repoRoot } from "./generated-artifacts.mjs";

const stale = [];
const unreadable = [];
const failures = [];

for (const artifact of generatedArtifacts) {
  const expected = await artifact.render();
  let actual;
  try {
    actual = await readFile(resolve(repoRoot, artifact.path), "utf8");
  } catch (error) {
    unreadable.push(
      `${artifact.path}: ${error instanceof Error ? error.message : String(error)}`
    );
    continue;
  }
  if (actual !== expected) {
    stale.push(artifact.path);
  }
  checkGeneratedArtifactLanguage(artifact.path, actual);
}

if (stale.length > 0 || unreadable.length > 0) {
  console.error("Generated artifacts are out of date or missing:");
  for (const path of stale) {
    console.error(`  - ${path}`);
  }
  for (const path of unreadable) {
    console.error(`  - ${path}`);
  }
  console.error("");
  console.error("Run:");
  console.error("  pnpm generated:write");
  process.exitCode = 1;
}

if (failures.length > 0) {
  console.error("Generated artifact language check failed:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
}

if (stale.length === 0 && unreadable.length === 0 && failures.length === 0) {
  console.log("Generated artifacts are in sync.");
}

function checkGeneratedArtifactLanguage(path, source) {
  if (path !== "docs/provider-capabilities.md") {
    return;
  }

  for (const internalMilestone of ["P0", "MVP"]) {
    if (new RegExp(`\\b${internalMilestone}\\b`).test(source)) {
      failures.push(
        `${path} should describe current provider behavior without internal milestone label ${internalMilestone}.`
      );
    }
  }

  for (const snippet of [
    'const provider = "cursor";',
    "const caps = await harness.agent(provider).capabilities();"
  ]) {
    if (!source.includes(snippet)) {
      failures.push(
        `${path} should show capability checks for an explicit selected provider with ${JSON.stringify(
          snippet
        )}.`
      );
    }
  }

  if (source.includes("harness.agent().capabilities()")) {
    failures.push(
      `${path} should not use the default provider in its provider capability example.`
    );
  }
}
