import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([
  ".git",
  ".harness",
  "coverage",
  "dist",
  "node_modules"
]);
const anchorCache = new Map();
const failures = [];

for (const markdownFile of await markdownFiles(repoRoot)) {
  const source = await readFile(markdownFile, "utf8");

  for (const link of markdownLinks(source)) {
    await checkLink(markdownFile, link);
  }
}

await checkDocsIndexCompleteness();
await checkDocsIndexStartHereGuidance();
await checkRootReadmeDocsCompleteness();
await checkWorkspacePackageMapCompleteness();

if (failures.length > 0) {
  throw new Error(`Markdown link check failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  "Markdown local links, docs index guidance, README docs list, and package maps are valid."
);

async function checkLink(markdownFile, link) {
  const target = parseMarkdownDestination(link.target);
  if (!target || isExternalTarget(target)) {
    return;
  }

  const { anchor, path } = splitLocalTarget(target);
  const targetPath = path ? resolve(dirname(markdownFile), path) : markdownFile;
  if (!isInsideRepo(targetPath)) {
    failures.push(
      `${formatLocation(markdownFile, link.line)} link ${JSON.stringify(
        target
      )} points outside the repository.`
    );
    return;
  }

  let targetStat;
  try {
    targetStat = await stat(targetPath);
  } catch {
    failures.push(
      `${formatLocation(markdownFile, link.line)} link ${JSON.stringify(
        target
      )} points to missing path ${formatPath(targetPath)}.`
    );
    return;
  }

  if (!anchor) {
    return;
  }
  if (targetStat.isDirectory()) {
    return;
  }
  if (extname(targetPath).toLowerCase() !== ".md") {
    failures.push(
      `${formatLocation(markdownFile, link.line)} link ${JSON.stringify(
        target
      )} uses an anchor on non-Markdown file ${formatPath(targetPath)}.`
    );
    return;
  }

  const anchors = await markdownAnchors(targetPath);
  const normalizedAnchor = normalizeAnchor(anchor);
  if (!anchors.has(normalizedAnchor)) {
    failures.push(
      `${formatLocation(markdownFile, link.line)} link ${JSON.stringify(
        target
      )} points to missing heading #${normalizedAnchor} in ${formatPath(targetPath)}.`
    );
  }
}

async function markdownFiles(root) {
  const found = [];

  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          await visit(path);
        }
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".md")) {
        found.push(path);
      }
    }
  }

  await visit(root);
  return found.sort();
}

async function checkDocsIndexCompleteness() {
  const docsRoot = resolve(repoRoot, "docs");
  const docsIndexPath = resolve(docsRoot, "README.md");
  const docsIndex = await readFile(docsIndexPath, "utf8");
  const indexTargets = localLinkTargets(docsIndex);

  for (const file of await docsIndexableFiles()) {
    if (!indexTargets.has(file)) {
      failures.push(`docs/README.md should link to docs/${file}.`);
    }
  }
}

async function checkDocsIndexStartHereGuidance() {
  const docsIndexPath = resolve(repoRoot, "docs/README.md");
  const docsIndex = await readFile(docsIndexPath, "utf8");
  const normalizedDocsIndex = docsIndex.replace(/\s+/g, " ");
  const requiredSnippets = [
    "[Development change map](development.md#change-map)",
    "find the right source files, tests, and public docs before changing the repo",
    "[Agent instructions](../AGENTS.md)",
    "when an AI coding agent is making or reviewing repo changes"
  ];

  for (const snippet of requiredSnippets) {
    if (!normalizedDocsIndex.includes(snippet.replace(/\s+/g, " "))) {
      failures.push(
        `docs/README.md should route contributors to the Development change map; missing ${JSON.stringify(
          snippet
        )}.`
      );
    }
  }
}

async function checkRootReadmeDocsCompleteness() {
  const rootReadmePath = resolve(repoRoot, "README.md");
  const rootReadme = await readFile(rootReadmePath, "utf8");
  const rootTargets = localLinkTargets(rootReadme);

  for (const file of await docsIndexableFiles()) {
    const target = `docs/${file}`;
    if (!rootTargets.has(target)) {
      failures.push(`README.md Documentation should link to ${target}.`);
    }
  }

  for (const target of [
    "docs/README.md",
    "examples/README.md",
    "CONTRIBUTING.md",
    "AGENTS.md",
    "SECURITY.md",
    "SUPPORT.md"
  ]) {
    if (!rootTargets.has(target)) {
      failures.push(`README.md Documentation should link to ${target}.`);
    }
  }
}

async function checkWorkspacePackageMapCompleteness() {
  const packageNames = await workspacePackageNames();

  await expectPackageList({
    heading: "Repository Status",
    label: "README.md Repository Status",
    markdownPath: resolve(repoRoot, "README.md"),
    packageNames
  });

  await expectPackageList({
    heading: "Package Map",
    label: "docs/development.md Package Map",
    markdownPath: resolve(repoRoot, "docs/development.md"),
    packageNames
  });
}

async function workspacePackageNames() {
  const packagesRoot = resolve(repoRoot, "packages");
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const names = [];

  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageJsonPath = resolve(packagesRoot, entry.name, "package.json");
    let packageJson;
    try {
      packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    } catch {
      continue;
    }

    if (typeof packageJson.name === "string") {
      names.push(packageJson.name);
    } else {
      failures.push(`packages/${entry.name}/package.json should include a name.`);
    }
  }

  return names.sort();
}

async function expectPackageList({ heading, label, markdownPath, packageNames }) {
  const source = await readFile(markdownPath, "utf8");
  const section = markdownSection(source, heading);
  if (!section) {
    failures.push(`${label} should include a "## ${heading}" section.`);
    return;
  }

  const documentedPackageNames = packageNamesIn(section);
  for (const packageName of packageNames) {
    if (!documentedPackageNames.has(packageName)) {
      failures.push(`${label} should list workspace package ${packageName}.`);
    }
  }

  for (const packageName of documentedPackageNames) {
    if (!packageNames.includes(packageName)) {
      failures.push(`${label} lists unknown workspace package ${packageName}.`);
    }
  }
}

async function docsIndexableFiles() {
  const docsRoot = resolve(repoRoot, "docs");
  return (await readdir(docsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .filter((file) => file !== "README.md")
    .sort();
}

function localLinkTargets(source) {
  return new Set(
    markdownLinks(source)
      .map((link) => parseMarkdownDestination(link.target))
      .filter(Boolean)
      .filter((target) => !isExternalTarget(target))
      .map((target) => splitLocalTarget(target).path)
      .filter(Boolean)
  );
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

function packageNamesIn(source) {
  return new Set(
    [...source.matchAll(/`(@metaharness\/[^`]+)`/g)].map((match) => match[1])
  );
}

function markdownLinks(source) {
  const links = [];
  let fenced = false;

  source.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fenced = !fenced;
      return;
    }
    if (fenced) {
      return;
    }

    const inlinePattern = /!?\[[^\]]+\]\(([^)\n]+)\)/g;
    for (const match of line.matchAll(inlinePattern)) {
      links.push({
        line: index + 1,
        target: match[1]
      });
    }

    const referencePattern = /^\s*\[[^\]]+\]:\s+(\S+)/;
    const reference = line.match(referencePattern);
    if (reference?.[1]) {
      links.push({
        line: index + 1,
        target: reference[1]
      });
    }
  });

  return links;
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

function isExternalTarget(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target);
}

function splitLocalTarget(target) {
  const hashIndex = target.indexOf("#");
  const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const rawAnchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1);
  const queryIndex = rawPath.indexOf("?");
  const path = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);

  return {
    anchor: safeDecode(rawAnchor),
    path: safeDecode(path)
  };
}

async function markdownAnchors(path) {
  const cached = anchorCache.get(path);
  if (cached) {
    return cached;
  }

  const source = await readFile(path, "utf8");
  const anchors = new Set();
  const counts = new Map();
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

    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!heading?.[1]) {
      continue;
    }

    const base = slugifyHeading(heading[1]);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }

  anchorCache.set(path, anchors);
  return anchors;
}

function slugifyHeading(heading) {
  return heading
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeAnchor(anchor) {
  return anchor.trim().toLowerCase();
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isInsideRepo(path) {
  const relativePath = relative(repoRoot, path);
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function formatLocation(path, line) {
  return `${formatPath(path)}:${line}`;
}

function formatPath(path) {
  return relative(repoRoot, path) || ".";
}
