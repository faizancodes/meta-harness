import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const examplesRoot = resolve(repoRoot, "examples");
const examplesIndexPath = resolve(examplesRoot, "README.md");
const examplesIndex = await readFile(examplesIndexPath, "utf8");
const githubActionRef = "your-org/metaharness/packages/github-action@v0";
const legacyGithubActionRef = "your-org/metaharness-action@v0";
const failures = [];

expectIndexIncludes(
  "pnpm examples:smoke",
  "The examples index should point contributors at the credential-free smoke test."
);
expectIndexIncludes(
  "pnpm setup:doctor",
  "The examples index should route fresh clones through the first-hour setup doctor."
);
expectIndexIncludes(
  "pnpm examples:docs:check",
  "The examples index should document the examples documentation drift check."
);
expectIndexIncludes(
  "pnpm hk runs",
  "The examples index should show how to discover recent run ids."
);
expectIndexIncludes(
  "pnpm hk stream latest",
  "The examples index should show how to inspect the newest event stream."
);
expectIndexIncludes(
  "pnpm hk ledger show latest",
  "The examples index should show how to inspect the newest ledger summary."
);

const exampleDirs = await immediateExampleDirectories();

expectIndexDecisionTable(exampleDirs);
expectIndexFreshClonePath();
expectIndexArtifactWorkflow();
await expectGithubActionExampleRef();

for (const exampleDir of exampleDirs) {
  const readmePath = resolve(examplesRoot, exampleDir, "README.md");
  const readme = await readExampleReadme(exampleDir, readmePath);
  if (!readme) {
    continue;
  }

  expectIndexLinksExample(exampleDir);
  expectReadmeShape(exampleDir, readme);
  expectRunArtifactGuidance(exampleDir, readme);
  expectCompareProviderGuidance(exampleDir, readme);
  expectCapabilityGuidance(exampleDir, readme);
  await expectSdkBasicPreflight(exampleDir, readme);
}

if (failures.length > 0) {
  throw new Error(`Example documentation check failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  `Example documentation is discoverable for ${exampleDirs.length} example directories.`
);

async function immediateExampleDirectories() {
  const entries = await readdir(examplesRoot, {
    withFileTypes: true
  });

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

async function readExampleReadme(exampleDir, readmePath) {
  try {
    await stat(readmePath);
  } catch {
    failures.push(`examples/${exampleDir} should include a README.md.`);
    return undefined;
  }

  return readFile(readmePath, "utf8");
}

async function expectGithubActionExampleRef() {
  const readmePath = resolve(examplesRoot, "github-action", "README.md");
  const workflowPath = resolve(examplesRoot, "github-action", "issue-fixer.yml");
  const [readme, workflow] = await Promise.all([
    readFile(readmePath, "utf8"),
    readFile(workflowPath, "utf8")
  ]);

  for (const [label, source] of [
    ["examples/github-action/README.md", readme],
    ["examples/github-action/issue-fixer.yml", workflow]
  ]) {
    if (!source.includes(githubActionRef)) {
      failures.push(`${label} should use placeholder action ref ${githubActionRef}.`);
    }
    if (source.includes(legacyGithubActionRef)) {
      failures.push(
        `${label} should not use legacy placeholder action ref ${legacyGithubActionRef}.`
      );
    }
  }

  if (
    !readme.includes("Prefer the generated `pnpm exec hk` workflow") ||
    !readme.includes("external pinned action's peer resolution")
  ) {
    failures.push(
      "examples/github-action/README.md should explain provider SDK peer resolution for generated CLI workflows versus direct pinned JavaScript actions."
    );
  }

  if (!readme.includes("if: always()")) {
    failures.push(
      "examples/github-action/README.md should explain that artifact upload uses if: always() so failed runs preserve diagnostics."
    );
  }

  if (!workflow.includes("if: always()")) {
    failures.push(
      "examples/github-action/issue-fixer.yml should upload .harness/runs with if: always() so failed action runs preserve diagnostics."
    );
  }
}

function expectIndexIncludes(expectedText, message) {
  if (!examplesIndex.includes(expectedText)) {
    failures.push(
      `examples/README.md should include ${JSON.stringify(expectedText)}. ${message}`
    );
  }
}

function expectIndexLinksExample(exampleDir) {
  const acceptedTargets = new Set([
    exampleDir,
    `${exampleDir}/`,
    `${exampleDir}/README.md`
  ]);
  const links = markdownLinks(examplesIndex);
  const hasDirectoryLink = links.some((link) => acceptedTargets.has(stripAnchor(link)));

  if (!hasDirectoryLink) {
    failures.push(
      `examples/README.md should link to examples/${exampleDir}/ as a README-backed example directory.`
    );
  }
}

function expectIndexDecisionTable(exampleDirs) {
  const section = markdownSection(examplesIndex, "Pick An Example");
  if (!section) {
    failures.push('examples/README.md should include a "## Pick An Example" section.');
    return;
  }

  const rows = tableRows(section);
  const header = rows[0];
  const expectedHeader = ["Example", "Use when you need to", "Credentials", "Start with"];
  if (!header || expectedHeader.some((cell, index) => header[index] !== cell)) {
    failures.push(
      `examples/README.md Pick An Example table should start with columns: ${expectedHeader.join(
        ", "
      )}.`
    );
    return;
  }

  for (const exampleDir of exampleDirs) {
    const row = rows.find((cells) =>
      markdownLinks(cells[0] ?? "").some((link) =>
        acceptedExampleTargets(exampleDir).has(stripAnchor(link))
      )
    );

    if (!row) {
      failures.push(
        `examples/README.md Pick An Example table should include examples/${exampleDir}.`
      );
      continue;
    }

    const [, useWhen, credentials, startWith] = row;
    if (!useWhen?.trim()) {
      failures.push(
        `examples/README.md Pick An Example row for examples/${exampleDir} should describe when to use it.`
      );
    }
    if (!credentials?.trim()) {
      failures.push(
        `examples/README.md Pick An Example row for examples/${exampleDir} should describe credential requirements.`
      );
    }
    if (!/`pnpm\s+[^`]+`/.test(startWith ?? "")) {
      failures.push(
        `examples/README.md Pick An Example row for examples/${exampleDir} should include a backticked pnpm start command.`
      );
    }
  }
}

function expectIndexFreshClonePath() {
  const normalizedIndex = normalizeWhitespace(examplesIndex);

  if (!normalizedIndex.includes("The setup doctor builds the repo-local `hk` CLI")) {
    failures.push(
      "examples/README.md should explain that pnpm setup:doctor builds the repo-local hk CLI before running the mock doctor."
    );
  }

  if (
    !normalizedIndex.includes(
      "Example scripts such as `pnpm examples:smoke` and `pnpm example:sdk` also build what they need before running."
    )
  ) {
    failures.push(
      "examples/README.md should explain that example scripts build what they need before running."
    );
  }

  if (examplesIndex.includes("after `pnpm install` and `pnpm build`")) {
    failures.push(
      "examples/README.md should use pnpm setup:doctor for fresh clones instead of requiring a separate manual build before examples."
    );
  }

  const section = markdownSection(examplesIndex, "Pick An Example");
  if (!section) {
    return;
  }

  const rows = tableRows(section);
  const quickstartRow = rows.find((cells) =>
    markdownLinks(cells[0] ?? "").some((link) =>
      acceptedExampleTargets("quickstart").has(stripAnchor(link))
    )
  );

  if (!quickstartRow?.[3]?.includes("pnpm setup:doctor")) {
    failures.push(
      "examples/README.md quickstart row should start fresh clones with pnpm setup:doctor."
    );
  }
}

function expectIndexArtifactWorkflow() {
  const section = markdownSection(examplesIndex, "After A CLI Example");
  if (!section) {
    failures.push(
      'examples/README.md should include an "## After A CLI Example" section.'
    );
    return;
  }

  const normalizedSection = normalizeWhitespace(section);
  for (const expectedText of [
    "active workspace's `storage.rootDir`",
    "`latest` for the newest run",
    "explicit run id from `pnpm hk runs`",
    "pnpm hk runs",
    "pnpm hk stream latest",
    "pnpm hk ledger show latest",
    "pnpm --silent hk ledger show latest --json",
    "pnpm hk ledger handoff latest",
    "pnpm artifacts:clean -- --dry-run",
    "events.ndjson",
    "result.json",
    "ledger.json",
    "handoff.md",
    "diff.patch",
    "verification.log",
    "raw provider events",
    "Treat `.harness/` as sensitive",
    "prompts, transcripts, diffs, command summaries, and provider metadata"
  ]) {
    if (!normalizedSection.includes(normalizeWhitespace(expectedText))) {
      failures.push(
        `examples/README.md After A CLI Example should mention ${JSON.stringify(
          expectedText
        )}.`
      );
    }
  }
}

function expectReadmeShape(exampleDir, readme) {
  if (!/^#\s+\S/m.test(readme)) {
    failures.push(
      `examples/${exampleDir}/README.md should start with a top-level heading.`
    );
  }

  const bashBlocks = fencedBashBlocks(readme);
  if (bashBlocks.length === 0) {
    failures.push(
      `examples/${exampleDir}/README.md should include at least one fenced bash command block.`
    );
    return;
  }

  if (!bashBlocks.some((block) => block.lines.some(isPnpmCommandLine))) {
    failures.push(
      `examples/${exampleDir}/README.md should include a fenced bash block with a repo-root pnpm command.`
    );
  }
}

function expectRunArtifactGuidance(exampleDir, readme) {
  const usesManualArtifactRunId =
    readme.includes("pnpm hk stream <run-id>") ||
    readme.includes("pnpm hk ledger show <run-id>") ||
    readme.includes("pnpm hk ledger handoff <run-id>");

  if (usesManualArtifactRunId && exampleDir !== "compare-providers") {
    failures.push(
      `examples/${exampleDir}/README.md should use pnpm hk runs plus latest for artifact inspection instead of manual <run-id> commands.`
    );
  }

  const inspectsLatestArtifacts =
    readme.includes("pnpm hk stream latest") ||
    readme.includes("pnpm hk ledger show latest") ||
    readme.includes("pnpm hk ledger handoff latest");
  if (inspectsLatestArtifacts && !readme.includes("pnpm hk runs")) {
    failures.push(
      `examples/${exampleDir}/README.md should pair latest artifact inspection with pnpm hk runs so older run ids stay discoverable.`
    );
  }

  if (readme.includes("--from-run <run-id>") && !readme.includes("pnpm hk runs")) {
    failures.push(
      `examples/${exampleDir}/README.md should show pnpm hk runs before requiring --from-run <run-id>.`
    );
  }
}

function expectCompareProviderGuidance(exampleDir, readme) {
  if (exampleDir !== "compare-providers") {
    return;
  }

  const normalizedReadme = normalizeWhitespace(readme);
  for (const expectedText of [
    "compare.md",
    "run id",
    "Use the run id from the compare table",
    "`latest` can point at the wrong run",
    "pnpm hk ledger show <run-id>",
    "pnpm hk stream <run-id>",
    "next"
  ]) {
    if (!normalizedReadme.includes(normalizeWhitespace(expectedText))) {
      failures.push(
        `examples/compare-providers/README.md should mention ${JSON.stringify(
          expectedText
        )} so users can inspect a selected provider result.`
      );
    }
  }
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function expectCapabilityGuidance(exampleDir, readme) {
  if (readme.includes("harness.agent().capabilities()")) {
    failures.push(
      `examples/${exampleDir}/README.md should check capabilities for the selected provider instead of the default provider.`
    );
  }

  if (
    readme.includes("ProviderCapabilities") ||
    readme.includes(".capabilities()") ||
    readme.includes("capability flags")
  ) {
    if (
      /\bprovider\s*(?:===|!==|==|!=)\s*["'](mock|claude|cursor|codex)["']/.test(readme)
    ) {
      failures.push(
        `examples/${exampleDir}/README.md should branch on capability flags instead of provider string comparisons.`
      );
    }
  }
}

async function expectSdkBasicPreflight(exampleDir, readme) {
  if (exampleDir !== "sdk-basic") {
    return;
  }

  if (!readme.includes('harness.doctor({ provider: "mock" })')) {
    failures.push(
      "examples/sdk-basic/README.md should document the SDK doctor preflight."
    );
  }

  for (const fileName of ["index.ts", "index.mjs"]) {
    const source = await readFile(resolve(examplesRoot, exampleDir, fileName), "utf8");
    if (!source.includes('harness.doctor({ provider: "mock" })')) {
      failures.push(`examples/sdk-basic/${fileName} should run SDK doctor first.`);
    }
  }
}

function markdownSection(source, heading) {
  const lines = source.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (startIndex === -1) {
    return undefined;
  }

  const nextHeadingIndex = lines.findIndex(
    (line, index) => index > startIndex && /^##\s+/.test(line)
  );
  const endIndex = nextHeadingIndex === -1 ? lines.length : nextHeadingIndex;
  return lines.slice(startIndex + 1, endIndex).join("\n");
}

function tableRows(source) {
  return source
    .split(/\r?\n/)
    .map((line) => tableCells(line))
    .filter(Boolean)
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
}

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
    return undefined;
  }
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function fencedBashBlocks(source) {
  const blocks = [];
  const lines = source.split(/\r?\n/);
  let activeBlock;

  lines.forEach((line, index) => {
    const fence = line.trimStart().match(/^```([^\s`]*)?\s*$/);
    if (!fence) {
      activeBlock?.lines.push(line);
      return;
    }

    if (activeBlock) {
      blocks.push(activeBlock);
      activeBlock = undefined;
      return;
    }

    if ((fence[1] ?? "") === "bash") {
      activeBlock = {
        line: index + 1,
        lines: []
      };
    }
  });

  return blocks;
}

function isPnpmCommandLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return false;
  }

  return /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*pnpm(?:\s|$)/.test(
    trimmed
  );
}

function markdownLinks(source) {
  const links = [];
  let fenced = false;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      continue;
    }

    const inlinePattern = /!?\[[^\]]+\]\(([^)\n]+)\)/g;
    for (const match of line.matchAll(inlinePattern)) {
      links.push(parseMarkdownDestination(match[1]));
    }
  }

  return links.filter(Boolean);
}

function parseMarkdownDestination(rawTarget) {
  const target = rawTarget.trim();
  if (!target) {
    return undefined;
  }
  if (target.startsWith("<")) {
    const end = target.indexOf(">");
    return end === -1 ? target.slice(1) : target.slice(1, end);
  }
  return target.split(/\s+/)[0];
}

function acceptedExampleTargets(exampleDir) {
  return new Set([exampleDir, `${exampleDir}/`, `${exampleDir}/README.md`]);
}

function stripAnchor(target) {
  const hashIndex = target.indexOf("#");
  const path = hashIndex === -1 ? target : target.slice(0, hashIndex);
  return path.replace(/^\.\//, "");
}
