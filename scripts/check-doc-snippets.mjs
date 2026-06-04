import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..");
const examplesRoot = resolve(repoRoot, "examples");
const packagesRoot = resolve(repoRoot, "packages");
const sdkDocsPath = resolve(repoRoot, "docs", "sdk.md");
const configurationDocsPath = resolve(repoRoot, "docs", "configuration.md");
const handoffDocsPath = resolve(repoRoot, "docs", "handoff.md");
const tempParent = resolve(repoRoot, ".harness");
await mkdir(tempParent, {
  recursive: true
});
const tempRoot = await mkdtemp(join(tempParent, "doc-snippets-"));
const failures = [];
const snippetRecords = [];
let snippetCount = 0;

try {
  checkReadmeSdkQuickstartGuidance(
    await readFile(resolve(repoRoot, "README.md"), "utf8")
  );
  checkConfigurationGuidance(await readFile(configurationDocsPath, "utf8"));
  checkSdkDoctorGuidance(await readFile(sdkDocsPath, "utf8"));
  checkSdkSurfaceGuidance(await readFile(sdkDocsPath, "utf8"));
  checkHandoffGuidance(await readFile(handoffDocsPath, "utf8"));
  const snippetFiles = [];

  for (const sourcePath of await snippetSourcePaths()) {
    const source = await readFile(sourcePath, "utf8");
    const snippets = typescriptSnippets(source);
    const sourceName = relative(repoRoot, sourcePath).replace(/[^a-zA-Z0-9_-]+/g, "-");

    for (const [index, snippet] of snippets.entries()) {
      const snippetPath = resolve(tempRoot, `${sourceName}-${index + 1}.ts`);
      const prepared = prepareSnippet(snippet.code);
      checkSnippetConventions({
        snippet,
        snippetIndex: index + 1,
        sourcePath
      });
      await writeFile(snippetPath, prepared.code, "utf8");
      snippetFiles.push(snippetPath);
      snippetRecords.push({
        codeStartLine: snippet.codeStartLine,
        contextLineCount: prepared.contextLineCount,
        path: snippetPath,
        snippetIndex: index + 1,
        sourcePath
      });
      snippetCount += 1;
    }
  }

  if (snippetFiles.length > 0) {
    await writeFile(
      resolve(tempRoot, "tsconfig.json"),
      `${JSON.stringify(
        {
          extends: "../../tsconfig.base.json",
          compilerOptions: {
            declaration: false,
            declarationMap: false,
            noEmit: true
          },
          include: snippetFiles.map((path) => pathRelativeToTemp(path))
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await checkSnippets();
  }
} finally {
  await rm(tempRoot, {
    force: true,
    recursive: true
  });
}

if (failures.length > 0) {
  throw new Error(`Documentation snippet check failed:\n- ${failures.join("\n- ")}`);
}

console.log(`Documentation TypeScript snippets typecheck (${snippetCount} checked).`);

async function snippetSourcePaths() {
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

function prepareSnippet(source) {
  const context = snippetContext(source);
  const body = `${context}${source}\n`;
  return {
    code:
      body.includes("import ") || body.includes("export ") ? body : `${body}export {};\n`,
    contextLineCount: lineCount(context)
  };
}

function checkSnippetConventions({ snippet, snippetIndex, sourcePath }) {
  const providerBranch = providerStringBranch(snippet.code);
  if (providerBranch) {
    failures.push(
      `${formatRepoPath(sourcePath)}:${
        snippet.codeStartLine + providerBranch.lineOffset
      } [snippet ${snippetIndex}] branches on provider string ${JSON.stringify(
        providerBranch.provider
      )}. Public examples should branch on ProviderCapabilities instead.`
    );
  }
}

function checkConfigurationGuidance(source) {
  const normalizedSource = source.replace(/\s+/g, " ");
  for (const expectedText of [
    "## Choose A Config Shape",
    'WORKDIR="$(mktemp -d)"',
    '/** @type {import("@metaharness/cli").HarnessConfig} */',
    "CLI-only workspaces install the CLI package",
    "Use `defineConfig()` in SDK code",
    "SDK configs still need matching adapter instances passed to `createHarness()`",
    "## Provider-Native MCP And Tools",
    "does not define a top-level `mcp` config field",
    "providers.<id>.native",
    "mcpServers",
    "native.codexOptions.config",
    "caps.tools.mcp.supported",
    "They do not turn provider-native MCP settings into a portable metaharness tool protocol.",
    'pnpm hk --cwd "$WORKDIR" doctor --provider mock',
    'pnpm hk --cwd "$WORKDIR" run --provider mock --task "Summarize this workspace"',
    'pnpm hk --cwd "$WORKDIR" ledger show latest',
    "The active `--cwd` is the base for config loading, policy paths, storage, and the `latest` run alias.",
    "metaharness_OTEL_EXPORTER",
    "metaharness_OTEL_SERVICE_NAME",
    "metaharness_OTEL_SERVICE_VERSION",
    "when both forms are set, the `metaharness_OTEL_*` value takes precedence"
  ]) {
    const haystack = expectedText.startsWith("## ") ? source : normalizedSource;
    if (!haystack.includes(expectedText)) {
      failures.push(
        `docs/configuration.md should explain CLI file config versus SDK defineConfig() usage with ${JSON.stringify(
          expectedText
        )}.`
      );
    }
  }
}

function checkSdkDoctorGuidance(source) {
  const normalizedSource = source.replace(/\s+/g, " ");
  for (const expectedText of [
    "## Preflight Provider Setup",
    'harness.doctor({ provider: "mock" })',
    "adapter registration",
    "configured API key environment variable"
  ]) {
    const haystack = expectedText.startsWith("## ") ? source : normalizedSource;
    if (!haystack.includes(expectedText)) {
      failures.push(
        `docs/sdk.md should include SDK doctor guidance with ${JSON.stringify(
          expectedText
        )}.`
      );
    }
  }
}

function checkSdkSurfaceGuidance(source) {
  const normalizedSource = source.replace(/\s+/g, " ");
  for (const expectedText of [
    "## SDK Surface At A Glance",
    "defineConfig()",
    "createHarness(config, adapters)",
    "harness.agent(provider).capabilities()",
    "harness.doctor({ provider })",
    "harness.startRun(input)",
    "ActiveRun",
    "events()",
    "wait()",
    "cancel()",
    "harness.compare(input)",
    "harness.handoff(input)",
    "harness.exportLedger(runId)",
    "harness.importLedger(pathOrLedger)",
    "harness.policy.check(input)",
    "harness.dispose()",
    "await harness.dispose()"
  ]) {
    const haystack = expectedText.startsWith("## ") ? source : normalizedSource;
    if (!haystack.includes(expectedText)) {
      failures.push(
        `docs/sdk.md should include an SDK surface map with ${JSON.stringify(
          expectedText
        )}.`
      );
    }
  }
}

function checkReadmeSdkQuickstartGuidance(source) {
  const normalizedSource = source.replace(/\s+/g, " ");
  const section = markdownSection(source, "SDK Quickstart");
  if (!section) {
    failures.push('README.md should include a "## SDK Quickstart" section.');
    return;
  }
  const normalizedSection = section.replace(/\s+/g, " ");
  for (const expectedText of [
    'const selectedProvider = "codex" as const',
    "new ClaudeAdapter()",
    "new CursorAdapter()",
    "new CodexAdapter()",
    "harness.doctor({ provider: selectedProvider })",
    'if (check.status === "fail")',
    "await harness.dispose()",
    "Run `harness.doctor()` before live work",
    "dispose the harness when a script or service shuts down"
  ]) {
    if (!normalizedSection.includes(expectedText)) {
      failures.push(
        `README.md SDK Quickstart should include lifecycle guidance with ${JSON.stringify(
          expectedText
        )}.`
      );
    }
  }
  if (
    !normalizedSource.includes("branch on capability flags instead of provider strings")
  ) {
    failures.push(
      "README.md should keep SDK guidance capability-driven instead of provider-string driven."
    );
  }
}

function checkHandoffGuidance(source) {
  const normalizedSource = source.replace(/\s+/g, " ");
  for (const expectedText of [
    "pnpm hk runs",
    "generated handoff prompt path",
    "destination run id",
    "`next` section",
    "pnpm hk ledger show <run-id>",
    "pnpm hk stream <run-id>",
    "pnpm hk ledger handoff <run-id>",
    "does not transfer hidden native provider session state"
  ]) {
    if (!normalizedSource.includes(expectedText)) {
      failures.push(
        `docs/handoff.md should include handoff CLI guidance with ${JSON.stringify(
          expectedText
        )}.`
      );
    }
  }
}

function markdownSection(source, heading) {
  const headingMatch = new RegExp(`^## ${escapeRegExp(heading)}\\s*$`, "m").exec(source);
  if (!headingMatch) {
    return undefined;
  }
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const rest = source.slice(sectionStart);
  const nextHeadingIndex = rest.search(/^##\s+/m);
  return nextHeadingIndex === -1 ? rest : rest.slice(0, nextHeadingIndex);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function providerStringBranch(source) {
  const providerIdentifier = "[A-Za-z_$][\\w$]*provider[A-Za-z_$0-9]*";
  const providerLiteral = String.raw`["'](mock|claude|cursor|codex)["']`;
  const comparisons = [
    new RegExp(
      String.raw`\b${providerIdentifier}\b\s*(?:===|!==|==|!=)\s*${providerLiteral}`,
      "i"
    ),
    new RegExp(
      String.raw`${providerLiteral}\s*(?:===|!==|==|!=)\s*\b${providerIdentifier}\b`,
      "i"
    )
  ];
  const switchPattern = new RegExp(
    String.raw`\bswitch\s*\([^)]*\b${providerIdentifier}\b`,
    "i"
  );

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    for (const pattern of comparisons) {
      const match = line.match(pattern);
      if (match?.[1]) {
        return {
          lineOffset: index,
          provider: match[1]
        };
      }
    }
    if (switchPattern.test(line)) {
      return {
        lineOffset: index,
        provider: "provider"
      };
    }
  }

  return undefined;
}

function snippetContext(source) {
  const declarations = [];

  if (referencesIdentifier(source, "harness") && !declaresIdentifier(source, "harness")) {
    declarations.push("declare const harness: Harness;");
  }
  if (
    referencesIdentifier(source, "selectedProvider") &&
    !declaresIdentifier(source, "selectedProvider")
  ) {
    declarations.push("declare const selectedProvider: ProviderId;");
  }
  if (
    referencesIdentifier(source, "selectedProviders") &&
    !declaresIdentifier(source, "selectedProviders")
  ) {
    declarations.push("declare const selectedProviders: ProviderId[];");
  }
  if (referencesIdentifier(source, "result") && !declaresIdentifier(source, "result")) {
    declarations.push(
      "declare const result: RunResult & { nativeSessionId: string; runId: string };"
    );
  }

  if (declarations.length === 0) {
    return "";
  }

  return [
    'import type { Harness, ProviderId, RunResult } from "@metaharness/core";',
    ...declarations,
    ""
  ].join("\n");
}

function referencesIdentifier(source, identifier) {
  return new RegExp(`\\b${identifier}\\b`).test(source);
}

function declaresIdentifier(source, identifier) {
  return new RegExp(`\\b(?:const|let|var|function|class)\\s+${identifier}\\b`).test(
    source
  );
}

async function checkSnippets() {
  try {
    await execFile(
      process.execPath,
      [
        resolve(repoRoot, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "-p",
        resolve(tempRoot, "tsconfig.json")
      ],
      {
        cwd: repoRoot,
        maxBuffer: 10 * 1024 * 1024
      }
    );
  } catch (error) {
    const processError = error;
    failures.push(
      [
        "tsc failed for documentation TypeScript snippets",
        annotateDiagnostics(processError.stdout?.trim() ?? ""),
        annotateDiagnostics(processError.stderr?.trim() ?? ""),
        formatSnippetSourceMap(),
        processError instanceof Error ? processError.message : String(processError)
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

function annotateDiagnostics(output) {
  if (!output) {
    return "";
  }

  let annotated = output;
  for (const record of snippetRecords) {
    for (const pathVariant of diagnosticPathVariants(record.path)) {
      const pattern = new RegExp(`${escapeRegex(pathVariant)}\\((\\d+),(\\d+)\\)`, "g");
      annotated = annotated.replace(pattern, (_match, lineText, columnText) => {
        const generatedLine = Number(lineText);
        const sourceLine = generatedLineToSourceLine(record, generatedLine);
        const sourceLocation = sourceLine
          ? `${formatRepoPath(record.sourcePath)}:${sourceLine}:${columnText}`
          : `${formatRepoPath(record.sourcePath)}:${record.codeStartLine}`;
        return `${sourceLocation} [snippet ${record.snippetIndex}; generated ${formatRepoPath(
          record.path
        )}:${lineText}:${columnText}]`;
      });
    }
  }
  return annotated;
}

function diagnosticPathVariants(path) {
  return [path, relative(repoRoot, path), pathRelativeToTemp(path)].filter(unique);
}

function generatedLineToSourceLine(record, generatedLine) {
  if (generatedLine <= record.contextLineCount) {
    return undefined;
  }
  return record.codeStartLine + (generatedLine - record.contextLineCount - 1);
}

function formatSnippetSourceMap() {
  if (snippetRecords.length === 0) {
    return "";
  }
  return [
    "Snippet source map:",
    ...snippetRecords.map(
      (record) =>
        `  ${formatRepoPath(record.path)} -> ${formatRepoPath(record.sourcePath)}:${
          record.codeStartLine
        } (snippet ${record.snippetIndex})`
    )
  ].join("\n");
}

function pathRelativeToTemp(path) {
  return relative(tempRoot, path);
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function lineCount(source) {
  return source ? source.split("\n").length - 1 : 0;
}

function formatRepoPath(path) {
  return relative(repoRoot, path) || ".";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unique(value, index, values) {
  return values.indexOf(value) === index;
}
