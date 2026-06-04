import { readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const packagesRoot = resolve(repoRoot, "packages");
const errorCodesDocPath = resolve(repoRoot, "docs/error-codes.md");
const troubleshootingDocPath = resolve(repoRoot, "docs/troubleshooting.md");
const sourceTokenPattern = /["']([A-Z][A-Z0-9_]{3,})["']/g;
const documentedCodePattern = /`([A-Z][A-Z0-9_]{3,})`/g;
const ignoredSourceTokens = new Set([
  "CANCELLED",
  "CLAUDE",
  "CREATING",
  "CURSOR",
  "EISDIR",
  "ENOENT",
  "ERROR",
  "EXPIRED",
  "FINISHED",
  "GITHUB_TOKEN",
  "HEAD",
  "RUNNING",
  "TRUE"
]);

const sourceCodes = await collectSourceCodes();
const errorCodesDoc = await readFile(errorCodesDocPath, "utf8");
const documentedCodes = extractCodes(errorCodesDoc, documentedCodePattern);
const troubleshooting = await readFile(troubleshootingDocPath, "utf8");
const missing = difference(sourceCodes, documentedCodes);
const stale = difference(documentedCodes, sourceCodes);
const failures = [];

if (missing.length > 0) {
  failures.push(
    [
      "docs/error-codes.md is missing source-derived codes:",
      ...missing.map((code) => `  - ${code}`)
    ].join("\n")
  );
}

if (stale.length > 0) {
  failures.push(
    [
      "docs/error-codes.md lists codes not found under packages/*/src:",
      ...stale.map((code) => `  - ${code}`)
    ].join("\n")
  );
}

checkTroubleshootingRecoveryGuidance();
checkErrorCodeRecoveryGuidance();

if (failures.length > 0) {
  throw new Error(
    [
      "Error code documentation is out of sync.",
      ...failures,
      "Add new public codes to docs/error-codes.md. If the token is not an error or diagnostic code, add it to ignoredSourceTokens in scripts/check-error-codes-doc.mjs."
    ].join("\n\n")
  );
}

console.log(
  `Error code documentation and troubleshooting recovery guidance are in sync (${sourceCodes.size} codes checked).`
);

function checkErrorCodeRecoveryGuidance() {
  for (const expectedText of [
    "`RUN_ARTIFACT_NOT_FOUND`",
    "CLI `--cwd`/`--config`",
    "SDK `workspace.cwd`",
    "`storage.rootDir`"
  ]) {
    if (!errorCodesDoc.includes(expectedText)) {
      failures.push(
        `docs/error-codes.md should include ${JSON.stringify(
          expectedText
        )} for run artifact recovery guidance.`
      );
    }
  }
}

function checkTroubleshootingRecoveryGuidance() {
  for (const expectedText of [
    "`COMPARE_FAILED` appears",
    ".harness/compares/<compare-id>/compare.md",
    "pnpm hk ledger show <run-id>",
    "pnpm hk stream <run-id>",
    "compare.json",
    "if: always()",
    "`HANDOFF_SOURCE_MISSING` appears",
    "Pass `--from-run <run-id>`",
    "`RUN_ID_MISSING` appears",
    "`RUN_ARTIFACT_NOT_FOUND`",
    "--cwd",
    "--config",
    "storage.rootDir"
  ]) {
    if (!troubleshooting.includes(expectedText)) {
      failures.push(
        `docs/troubleshooting.md should include ${JSON.stringify(
          expectedText
        )} for error recovery guidance.`
      );
    }
  }
}

async function collectSourceCodes() {
  const codes = new Set();

  for (const sourcePath of await sourceFiles(packagesRoot)) {
    const source = await readFile(sourcePath, "utf8");
    for (const code of extractCodes(source, sourceTokenPattern)) {
      if (!isIgnoredSourceToken(code)) {
        codes.add(code);
      }
    }
  }

  return codes;
}

async function sourceFiles(directory) {
  const found = [];

  async function visit(currentDirectory) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const path = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "dist" && entry.name !== "node_modules") {
          await visit(path);
        }
        continue;
      }
      if (entry.isFile() && isSourceFile(path) && isPackageSourcePath(path)) {
        found.push(path);
      }
    }
  }

  await visit(directory);
  return found.sort();
}

function isSourceFile(path) {
  return [".js", ".mjs", ".ts", ".tsx"].includes(extname(path));
}

function isPackageSourcePath(path) {
  return relative(packagesRoot, path).split(sep).includes("src");
}

function extractCodes(source, pattern) {
  const codes = new Set();
  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      codes.add(match[1]);
    }
  }
  return codes;
}

function isIgnoredSourceToken(code) {
  return (
    ignoredSourceTokens.has(code) ||
    code.endsWith("_API_KEY") ||
    code.startsWith("METAHARNESS_TEST_") ||
    code.startsWith("TEST_")
  );
}

function difference(left, right) {
  return [...left].filter((code) => !right.has(code)).sort();
}
