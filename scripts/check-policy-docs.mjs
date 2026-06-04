import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";

const repoRoot = resolve(import.meta.dirname, "..");
const examplesRoot = resolve(repoRoot, "examples");
const packagesRoot = resolve(repoRoot, "packages");
const policyModuleUrl = pathToFileURL(resolve(repoRoot, "packages/policy/dist/index.js"));
const failures = [];

let parsePolicyYaml;
try {
  ({ parsePolicyYaml } = await import(policyModuleUrl.href));
} catch (error) {
  throw new Error(
    [
      "Policy documentation check needs a built @metaharness/policy package.",
      "Run pnpm --filter @metaharness/policy build before node scripts/check-policy-docs.mjs."
    ].join("\n"),
    {
      cause: error
    }
  );
}

let checkedCount = 0;

for (const sourcePath of await markdownSourcePaths()) {
  const source = await readFile(sourcePath, "utf8");

  for (const [index, snippet] of yamlSnippets(source).entries()) {
    if (!looksLikePolicyYaml(snippet.code)) {
      continue;
    }
    validatePolicyYaml({
      code: snippet.code,
      origin: `YAML snippet ${index + 1}`,
      sourcePath,
      startLine: snippet.codeStartLine
    });
  }

  for (const [index, snippet] of typescriptSnippets(source).entries()) {
    for (const literal of parsePolicyYamlLiterals(snippet)) {
      validatePolicyYaml({
        code: literal.code,
        origin: `TypeScript snippet ${index + 1} parsePolicyYaml() literal`,
        sourcePath,
        startLine: literal.startLine
      });
    }
  }
}

if (checkedCount === 0) {
  failures.push("No public metaharness policy snippets were found to validate.");
}

if (failures.length > 0) {
  throw new Error(`Policy documentation check failed:\n- ${failures.join("\n- ")}`);
}

console.log(`Policy documentation snippets validate (${checkedCount} checked).`);

async function markdownSourcePaths() {
  const packageReadmes = (await packageDirectories()).map((packageDir) =>
    resolve(packagesRoot, packageDir, "README.md")
  );
  const docFiles = (await readdir(resolve(repoRoot, "docs")))
    .filter((file) => file.endsWith(".md"))
    .map((file) => resolve(repoRoot, "docs", file));
  const exampleFiles = await markdownFiles(examplesRoot);
  return [
    resolve(repoRoot, "README.md"),
    ...docFiles.sort(),
    ...exampleFiles,
    ...packageReadmes
  ];
}

async function markdownFiles(directory) {
  const found = [];

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, {
      withFileTypes: true
    });

    for (const entry of entries) {
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

async function packageDirectories() {
  const entries = await readdir(packagesRoot, {
    withFileTypes: true
  });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function yamlSnippets(source) {
  const snippets = [];
  const pattern = /^```(?:ya?ml)(?:[ \t]+[^\r\n]*)?\s*$([\s\S]*?)^```$/gm;

  for (const match of source.matchAll(pattern)) {
    const code = match[1]?.replace(/^\r?\n/, "").trimEnd();
    if (code?.trim()) {
      snippets.push({
        code,
        codeStartLine: lineNumberAt(source, match.index ?? 0) + 1
      });
    }
  }

  return snippets;
}

function typescriptSnippets(source) {
  const snippets = [];
  const pattern = /^```(?:ts|typescript)\s*$([\s\S]*?)^```$/gm;

  for (const match of source.matchAll(pattern)) {
    const code = match[1]?.replace(/^\r?\n/, "").trimEnd();
    if (code?.trim()) {
      snippets.push({
        code,
        codeStartLine: lineNumberAt(source, match.index ?? 0) + 1
      });
    }
  }

  return snippets;
}

function looksLikePolicyYaml(source) {
  if (skipPolicyCheck(source)) {
    return false;
  }
  const keys = topLevelYamlKeys(source);
  return (
    (keys.has("version") && policySectionCount(keys) > 0) ||
    (keys.has("filesystem") && keys.has("commands"))
  );
}

function parsePolicyYamlLiterals(snippet) {
  const found = [];
  const sourceFile = ts.createSourceFile(
    "doc-snippet.ts",
    snippet.code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      expressionName(node.expression) === "parsePolicyYaml"
    ) {
      const firstArgument = node.arguments[0];
      const code = stringLiteralValue(firstArgument);
      if (code && !skipPolicyCheck(code)) {
        found.push({
          code,
          startLine:
            snippet.codeStartLine +
            lineNumberAt(snippet.code, firstArgument.getStart(sourceFile)) -
            1
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

function expressionName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function stringLiteralValue(node) {
  if (!node) {
    return undefined;
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function validatePolicyYaml({ code, origin, sourcePath, startLine }) {
  checkedCount += 1;
  const parsed = parsePolicyYaml(code);
  const location = `${formatRepoPath(sourcePath)}:${startLine}`;

  if (parsed.diagnostics.errors.length > 0) {
    failures.push(
      `${location} [${origin}] invalid metaharness policy YAML: ${formatDiagnostics(
        parsed.diagnostics.errors
      )}`
    );
  }

  const warnings = [
    ...parsed.diagnostics.warnings,
    ...parsed.diagnostics.providerWarnings
  ];
  if (warnings.length > 0 && !allowsPolicyWarnings(code)) {
    failures.push(
      `${location} [${origin}] public policy examples should be warning-free: ${formatDiagnostics(
        warnings
      )}`
    );
  }
}

function topLevelYamlKeys(source) {
  const keys = new Set();
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s|$)/);
    if (match?.[1]) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function policySectionCount(keys) {
  let count = 0;
  for (const key of [
    "filesystem",
    "network",
    "commands",
    "approvals",
    "secrets",
    "limits",
    "providerOverrides"
  ]) {
    if (keys.has(key)) {
      count += 1;
    }
  }
  return count;
}

function skipPolicyCheck(source) {
  return /metaharness-docs:\s*skip-policy-check/.test(source);
}

function allowsPolicyWarnings(source) {
  return /metaharness-docs:\s*allow-policy-warnings/.test(source);
}

function formatDiagnostics(diagnostics) {
  return diagnostics
    .map((diagnostic) =>
      [
        diagnostic.code,
        diagnostic.path ? `at ${diagnostic.path}` : undefined,
        diagnostic.message
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join("; ");
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function formatRepoPath(path) {
  return relative(repoRoot, path) || ".";
}
