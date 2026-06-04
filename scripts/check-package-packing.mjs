import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = resolve(repoRoot, "packages");
const rootManifest = JSON.parse(
  await readFile(resolve(repoRoot, "package.json"), "utf8")
);
const providerSdkPackages = new Set([
  "@anthropic-ai/claude-agent-sdk",
  "@cursor/sdk",
  "@openai/codex-sdk"
]);
const sdkReadmePreflightProviders = new Map([
  ["@metaharness/adapter-mock", "mock"],
  ["@metaharness/claude", "claude"],
  ["@metaharness/codex", "codex"],
  ["@metaharness/core", "mock"],
  ["@metaharness/cursor", "cursor"]
]);

const packageDirs = await publishedPackageDirectories();
const packageNames = new Set(
  await Promise.all(
    packageDirs.map(async (packageDir) => {
      const manifest = await readPackageManifest(packageDir);
      return manifest.name;
    })
  )
);
const tempRoot = await mkdtemp(join(tmpdir(), "metaharness-package-check-"));
const failures = [];
let packedCount = 0;

try {
  for (const packageDir of packageDirs) {
    const manifest = await readPackageManifest(packageDir);
    const tarball = await packPackage(packageDir);
    const entries = await listTarballEntries(tarball);
    const packedManifest = await readPackedManifest(tarball);

    packedCount += 1;
    await checkPackedPackage({
      entries,
      manifest,
      packageDir,
      packedManifest,
      tarball
    });
  }
} finally {
  await rm(tempRoot, {
    force: true,
    recursive: true
  });
}

if (failures.length > 0) {
  throw new Error(`Package packing check failed:\n- ${failures.join("\n- ")}`);
}

console.log(`Packed ${packedCount} publishable packages with usable tarballs.`);

async function publishedPackageDirectories() {
  const entries = await readdir(packagesRoot, {
    withFileTypes: true
  });
  const packageDirs = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = entry.name;
    const manifest = await readPackageManifest(packageDir);
    if (manifest.private !== true) {
      packageDirs.push(packageDir);
    }
  }

  return packageDirs.sort();
}

async function readPackageManifest(packageDir) {
  return JSON.parse(
    await readFile(resolve(packagesRoot, packageDir, "package.json"), "utf8")
  );
}

async function packPackage(packageDir) {
  const destination = resolve(tempRoot, packageDir);
  await mkdir(destination, {
    recursive: true
  });

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

  const tarballs = (await readdir(destination)).filter((file) => file.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    failures.push(
      `${packageDir} should produce one tarball, produced ${tarballs.length}.`
    );
    return resolve(destination, tarballs[0] ?? "missing.tgz");
  }

  return resolve(destination, tarballs[0]);
}

async function listTarballEntries(tarball) {
  const { stdout } = await execFile("tar", ["-tzf", tarball], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024
  });

  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

async function readPackedManifest(tarball) {
  const { stdout } = await execFile("tar", ["-xOf", tarball, "package/package.json"], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024
  });

  return JSON.parse(stdout);
}

async function checkPackedPackage({
  entries,
  manifest,
  packageDir,
  packedManifest,
  tarball
}) {
  const entrySet = new Set(entries);
  const label = `${manifest.name} (${packageDir})`;

  expectEntry(label, entrySet, "package/package.json");
  expectEntry(label, entrySet, "package/README.md");
  expectManifestValue(label, packedManifest.name, manifest.name, "name");
  expectManifestValue(label, packedManifest.version, manifest.version, "version");
  expectManifestJsonValue(label, packedManifest.keywords, manifest.keywords, "keywords");
  expectManifestValue(label, packedManifest.type, "module", "type");
  expectManifestValue(label, packedManifest.types, manifest.types, "types");
  expectManifestValue(
    label,
    packedManifest.exports?.["."]?.import,
    manifest.exports?.["."]?.import,
    "exports[.].import"
  );
  expectManifestValue(
    label,
    packedManifest.exports?.["."]?.types,
    manifest.exports?.["."]?.types,
    "exports[.].types"
  );

  expectEntry(label, entrySet, packedEntry(manifest.types));
  expectEntry(label, entrySet, packedEntry(manifest.exports?.["."]?.import));
  expectEntry(label, entrySet, packedEntry(manifest.exports?.["."]?.types));

  if (manifest.name === "@metaharness/github-action") {
    expectEntry(label, entrySet, "package/action.yml");
  }

  for (const [binName, binTarget] of Object.entries(manifest.bin ?? {})) {
    expectEntry(label, entrySet, packedEntry(binTarget));
    if (entrySet.has(packedEntry(binTarget))) {
      await checkBinShebang(label, binName, tarball, binTarget);
    }
  }

  checkNoWorkspaceProtocols(label, packedManifest);
  checkNoProviderSdkDependencies(label, packedManifest);
  checkProviderPeerVersions(label, packedManifest);
  checkInternalDependenciesAreConcrete(label, packedManifest);
  checkNoSourceOrLocalFiles(label, entries);
  await checkReadmeShape({
    label,
    manifest,
    packageRoot: resolve(packagesRoot, packageDir)
  });
  await checkReadmeLocalLinks({
    entrySet,
    label,
    packageDir,
    packageRoot: resolve(packagesRoot, packageDir)
  });
}

function expectEntry(label, entrySet, entry) {
  if (!entry || !entrySet.has(entry)) {
    failures.push(`${label} tarball is missing ${entry ?? "an expected entry"}.`);
  }
}

function expectManifestValue(label, actual, expected, field) {
  if (actual !== expected) {
    failures.push(
      `${label} packed package.json ${field} should be ${JSON.stringify(
        expected
      )}, got ${JSON.stringify(actual)}.`
    );
  }
}

function expectManifestJsonValue(label, actual, expected, field) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label} packed package.json ${field} should be ${JSON.stringify(
        expected
      )}, got ${JSON.stringify(actual)}.`
    );
  }
}

function packedEntry(path) {
  if (typeof path !== "string") {
    return undefined;
  }

  return `package/${path.replace(/^\.\//, "")}`;
}

async function checkBinShebang(label, binName, tarball, binTarget) {
  const { stdout } = await execFile("tar", ["-xOf", tarball, packedEntry(binTarget)], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024
  });

  if (!stdout.startsWith("#!/usr/bin/env node")) {
    failures.push(
      `${label} bin ${binName} target ${binTarget} is missing a Node shebang.`
    );
  }
}

function checkNoWorkspaceProtocols(label, manifest) {
  for (const [field, dependencies] of dependencyFields(manifest)) {
    for (const [dependencyName, range] of Object.entries(dependencies)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        failures.push(
          `${label} packed package.json ${field}.${dependencyName} still uses ${range}.`
        );
      }
    }
  }
}

function checkNoProviderSdkDependencies(label, manifest) {
  for (const providerPackage of providerSdkPackages) {
    if (manifest.dependencies?.[providerPackage]) {
      failures.push(`${label} must not publish ${providerPackage} as a dependency.`);
    }

    if (
      manifest.peerDependencies?.[providerPackage] &&
      manifest.peerDependenciesMeta?.[providerPackage]?.optional !== true
    ) {
      failures.push(`${label} must publish ${providerPackage} as an optional peer.`);
    }
  }
}

function checkProviderPeerVersions(label, manifest) {
  for (const providerPackage of providerSdkPackages) {
    const peerRange = manifest.peerDependencies?.[providerPackage];
    if (!peerRange) {
      continue;
    }

    const rootRange = rootManifest.devDependencies?.[providerPackage];
    if (!rootRange) {
      failures.push(
        `${label} declares ${providerPackage} as a peer but the root devDependencies do not install it for conformance.`
      );
      continue;
    }

    if (peerRange !== rootRange) {
      failures.push(
        `${label} peerDependencies.${providerPackage} should match the root devDependency range ${JSON.stringify(
          rootRange
        )}, got ${JSON.stringify(peerRange)}.`
      );
    }
  }
}

function checkInternalDependenciesAreConcrete(label, manifest) {
  for (const [field, dependencies] of dependencyFields(manifest)) {
    for (const [dependencyName, range] of Object.entries(dependencies)) {
      if (!packageNames.has(dependencyName)) {
        continue;
      }

      if (typeof range !== "string" || !/^\d+\.\d+\.\d+/.test(range)) {
        failures.push(
          `${label} packed package.json ${field}.${dependencyName} should be a concrete version, got ${JSON.stringify(
            range
          )}.`
        );
      }
    }
  }
}

function checkNoSourceOrLocalFiles(label, entries) {
  const forbiddenPatterns = [
    /(^|\/)src\//,
    /(^|\/)test\//,
    /(^|\/)node_modules\//,
    /(^|\/)\.harness\//,
    /(^|\/)coverage\//,
    /\.tsbuildinfo$/,
    /(^|\/)tsconfig[^/]*\.json$/,
    /(^|\/)pnpm-lock\.yaml$/,
    /(^|\/)\.gitignore$/,
    /(^|\/)\.ignore$/
  ];

  for (const entry of entries) {
    if (forbiddenPatterns.some((pattern) => pattern.test(entry))) {
      failures.push(`${label} tarball includes local-only file ${entry}.`);
    }
  }
}

async function checkReadmeShape({ label, manifest, packageRoot }) {
  const readme = await readFile(resolve(packageRoot, "README.md"), "utf8");
  const firstContentLine = readme.split(/\r?\n/).find((line) => line.trim());
  if (firstContentLine !== `# ${manifest.name}`) {
    failures.push(
      `${label} README.md should start with "# ${manifest.name}", got ${JSON.stringify(
        firstContentLine
      )}.`
    );
  }

  const headings = markdownHeadings(readme);
  const levelTwoHeadings = headings
    .filter((heading) => heading.depth === 2)
    .map((heading) => heading.text);

  for (const heading of ["Install", "Notes"]) {
    if (!levelTwoHeadings.includes(heading)) {
      failures.push(`${label} README.md should include "## ${heading}".`);
    }
  }

  if (
    !levelTwoHeadings.some((heading) => heading === "Use" || heading.startsWith("Use "))
  ) {
    failures.push(`${label} README.md should include a "## Use" section.`);
  }

  if (levelTwoHeadings.at(-1) !== "Notes") {
    failures.push(`${label} README.md should end its main sections with "## Notes".`);
  }

  for (const snippet of [
    "SUPPORT.md",
    "support routes",
    "issue templates",
    "sensitive artifact guidance",
    runtimeReadmeNote(manifest.engines?.node)
  ]) {
    if (!readme.includes(snippet)) {
      failures.push(
        `${label} README.md should include package consumer support guidance with ${JSON.stringify(
          snippet
        )}.`
      );
    }
  }

  const installSection = markdownSection(readme, "Install");
  if (!/\bpnpm\s+add\b/.test(installSection)) {
    failures.push(
      `${label} README.md Install section should include a pnpm add command.`
    );
  }

  const preflightProvider = sdkReadmePreflightProviders.get(manifest.name);
  if (preflightProvider) {
    checkSdkReadmePreflight({
      label,
      provider: preflightProvider,
      readme
    });
    checkSdkReadmeLifecycle({ label, readme });
  }

  for (const providerPackage of providerSdkPackages) {
    if (!manifest.peerDependencies?.[providerPackage]) {
      continue;
    }
    if (!readme.includes(providerPackage)) {
      failures.push(
        `${label} README.md should mention optional peer SDK ${providerPackage}.`
      );
    }
  }

  if (
    Object.keys(manifest.peerDependencies ?? {}).length > 0 &&
    !/optional peer/i.test(readme)
  ) {
    failures.push(`${label} README.md should explain provider SDKs are optional peers.`);
  }

  if (manifest.name === "@metaharness/cli") {
    const adapterPackages = [
      "@metaharness/adapter-mock",
      "@metaharness/claude",
      "@metaharness/codex",
      "@metaharness/cursor"
    ];
    for (const adapterPackage of adapterPackages) {
      if (!manifest.dependencies?.[adapterPackage]) {
        failures.push(
          `${label} should depend on ${adapterPackage} so CLI users do not install adapters separately.`
        );
      }
    }

    if (!/includes the metaharness adapter packages/i.test(readme)) {
      failures.push(
        `${label} README.md should say the CLI includes the metaharness adapter packages.`
      );
    }

    if (/install the provider adapters and SDKs/i.test(readme)) {
      failures.push(
        `${label} README.md should not tell CLI users to install provider adapters separately.`
      );
    }

    for (const snippet of [
      "pnpm exec hk init --providers mock",
      "pnpm exec hk doctor --provider mock",
      "pnpm exec hk runs",
      "pnpm exec hk stream latest",
      "pnpm exec hk ledger show latest",
      "pnpm exec hk ledger handoff latest",
      "`next` section",
      "pnpm exec hk compare",
      ".harness/compares/<compare-id>/compare.md",
      "run id for each provider result",
      "pnpm exec hk ledger show <run-id>",
      "pnpm exec hk stream <run-id>",
      "pnpm exec hk handoff",
      "--from-run <run-id>",
      "hidden provider-native session",
      "pnpm --silent exec hk run"
    ]) {
      if (!readme.includes(snippet)) {
        failures.push(
          `${label} README.md should include installed CLI workflow guidance with ${JSON.stringify(
            snippet
          )}.`
        );
      }
    }
  }

  if (manifest.name === "@metaharness/core") {
    for (const snippet of [
      "## Common SDK Workflows",
      "runResult.runId",
      "runResult.ledgerPath",
      "runResult.handoffPath",
      "runResult.patchPath",
      "harness.compare",
      "compareResult.runs",
      "compareResult.compareMarkdownPath",
      "harness.handoff",
      "fromRunId: sourceRun.runId",
      "handoff.handoffPromptPath",
      "handoff.toRun.runId",
      "does not transfer hidden provider-native session state"
    ]) {
      if (!readme.includes(snippet)) {
        failures.push(
          `${label} README.md should include common SDK workflow guidance with ${JSON.stringify(
            snippet
          )}.`
        );
      }
    }
  }

  if (manifest.name === "@metaharness/github-action") {
    for (const snippet of [
      "## Use From GitHub Actions",
      "uses: actions/checkout@v5",
      "uses: your-org/metaharness/packages/github-action@v0",
      "id: metaharness",
      "## Outputs And Artifacts",
      "steps.metaharness.outputs.run-id",
      "ACTION_RUN_FAILED",
      "fallback-provider",
      "actions/upload-artifact@v4",
      "if: always()",
      "ledger-file",
      "handoff-file",
      "patch-file",
      "open-pull-request",
      "Prefer the generated `pnpm exec hk` workflow",
      "external pinned action's peer resolution"
    ]) {
      if (!readme.includes(snippet)) {
        failures.push(
          `${label} README.md should include GitHub Actions workflow guidance with ${JSON.stringify(
            snippet
          )}.`
        );
      }
    }
  }

  if (manifest.name === "@metaharness/telemetry") {
    for (const snippet of [
      "METAHARNESS_OTEL_EXPORTER",
      "metaharness_OTEL_EXPORTER",
      "metaharness_OTEL_SERVICE_NAME",
      "metaharness_OTEL_SERVICE_VERSION",
      "when both forms are set, the",
      "`metaharness_OTEL_*` value takes precedence"
    ]) {
      if (!readme.includes(snippet)) {
        failures.push(
          `${label} README.md should explain telemetry environment aliases with ${JSON.stringify(
            snippet
          )}.`
        );
      }
    }
  }
}

function checkSdkReadmePreflight({ label, provider, readme }) {
  const preflightSection = markdownSection(readme, "Preflight");
  if (!preflightSection) {
    failures.push(`${label} README.md should include a "## Preflight" section.`);
    return;
  }
  const normalizedSection = preflightSection.toLowerCase();

  for (const snippet of [
    "before the first",
    "harness.doctor",
    `provider: "${provider}"`,
    "failedChecks"
  ]) {
    if (!normalizedSection.includes(snippet.toLowerCase())) {
      failures.push(
        `${label} README.md Preflight section should include ${JSON.stringify(snippet)}.`
      );
    }
  }
}

function checkSdkReadmeLifecycle({ label, readme }) {
  for (const snippet of ["await harness.dispose()", "shutdown hooks"]) {
    if (!readme.includes(snippet)) {
      failures.push(
        `${label} README.md should include SDK lifecycle cleanup guidance with ${JSON.stringify(
          snippet
        )}.`
      );
    }
  }

  const useSection = markdownSection(readme, "Use");
  for (const snippet of ["try {", "finally {", "await harness.dispose()"]) {
    if (!useSection.includes(snippet)) {
      failures.push(
        `${label} README.md Use section should show copy-paste harness cleanup with ${JSON.stringify(
          snippet
        )}.`
      );
    }
  }
}

async function checkReadmeLocalLinks({ entrySet, label, packageDir, packageRoot }) {
  const readmePath = resolve(packageRoot, "README.md");
  const readme = await readFile(readmePath, "utf8");

  for (const link of markdownLinks(readme)) {
    const target = parseMarkdownDestination(link.target);
    if (!target || isExternalTarget(target)) {
      continue;
    }

    const { path } = splitLocalTarget(target);
    if (!path) {
      continue;
    }

    const targetPath = resolve(packageRoot, path);
    if (!isInsideDirectory(packageRoot, targetPath)) {
      failures.push(
        `${label} README.md:${link.line} local link ${JSON.stringify(
          target
        )} points outside packages/${packageDir} and will be broken in the packed package.`
      );
      continue;
    }

    const packedPath = packedEntry(relative(packageRoot, targetPath));
    if (!entrySet.has(packedPath)) {
      failures.push(
        `${label} README.md:${link.line} local link ${JSON.stringify(
          target
        )} points to ${packedPath}, which is not included in the packed package.`
      );
    }
  }
}

function markdownHeadings(source) {
  const headings = [];
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

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading?.[1] && heading[2]) {
      headings.push({
        depth: heading[1].length,
        line: index + 1,
        text: heading[2].trim()
      });
    }
  });

  return headings;
}

function markdownSection(source, headingText) {
  const lines = source.split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${escapeRegex(headingText)}\\s*#*\\s*$`);
  const startIndex = lines.findIndex((line) => headingPattern.test(line));
  if (startIndex === -1) {
    return "";
  }

  const body = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^##\s+\S/.test(line)) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
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
  const queryIndex = rawPath.indexOf("?");
  const path = queryIndex === -1 ? rawPath : rawPath.slice(0, queryIndex);

  return {
    path: safeDecode(path)
  };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isInsideDirectory(root, path) {
  const relativePath = relative(root, path);
  return (
    relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runtimeReadmeNote(nodeEngine) {
  if (nodeEngine === ">=20.0.0") {
    return "Requires Node.js 20 or newer";
  }
  return "Requires Node.js 22 or newer";
}

function dependencyFields(manifest) {
  return [
    ["dependencies", manifest.dependencies ?? {}],
    ["peerDependencies", manifest.peerDependencies ?? {}],
    ["optionalDependencies", manifest.optionalDependencies ?? {}],
    ["devDependencies", manifest.devDependencies ?? {}]
  ];
}
