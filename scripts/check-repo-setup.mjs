import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const repoRoot = resolve(import.meta.dirname, "..");
const execFile = promisify(execFileCallback);

const files = Object.fromEntries(
  await Promise.all(
    [
      ".gitignore",
      ".editorconfig",
      ".env.example",
      "AGENTS.md",
      "CONTRIBUTING.md",
      ".github/ISSUE_TEMPLATE/bug_report.md",
      ".github/ISSUE_TEMPLATE/config.yml",
      ".github/ISSUE_TEMPLATE/feature_request.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      ".ignore",
      ".node-version",
      ".npmrc",
      ".nvmrc",
      ".prettierignore",
      "SECURITY.md",
      "SUPPORT.md",
      "eslint.config.mjs",
      "package.json",
      "pnpm-workspace.yaml"
    ].map(async (path) => [path, await readFile(resolve(repoRoot, path), "utf8")])
  )
);

const packageJson = JSON.parse(files["package.json"]);
const editorConfig = parseKeyValueFile(files[".editorconfig"]);
const npmrc = parseKeyValueFile(files[".npmrc"]);
const workspace = parseKeyValueFile(files["pnpm-workspace.yaml"]);
const failures = [];
const currentPnpmVersion = await readPnpmVersion();

expectValue("package.json packageManager", packageJson.packageManager, "pnpm@9.13.0");
expectValue("package.json engines.node", packageJson.engines?.node, ">=22.0.0");
expectValue("package.json engines.pnpm", packageJson.engines?.pnpm, ">=9.13.0");
expectVersionSatisfies(
  "current Node version",
  process.version.replace(/^v/, ""),
  packageJson.engines?.node
);
expectVersionSatisfies(
  "current pnpm version",
  currentPnpmVersion,
  packageJson.engines?.pnpm
);
expectValue(".nvmrc", files[".nvmrc"].trim(), "22");
expectValue(".node-version", files[".node-version"].trim(), "22");
expectValue(".editorconfig root", editorConfig.root, "true");
expectValue(".editorconfig charset", editorConfig.charset, "utf-8");
expectValue(".editorconfig end_of_line", editorConfig.end_of_line, "lf");
expectValue(
  ".editorconfig insert_final_newline",
  editorConfig.insert_final_newline,
  "true"
);
expectValue(".editorconfig indent_style", editorConfig.indent_style, "space");
expectValue(".editorconfig indent_size", editorConfig.indent_size, "2");
expectValue(
  ".editorconfig trim_trailing_whitespace",
  editorConfig.trim_trailing_whitespace,
  "true"
);
expectValue(".npmrc auto-install-peers", npmrc["auto-install-peers"], "false");
expectValue(".npmrc engine-strict", npmrc["engine-strict"], "true");
expectValue(
  ".npmrc manage-package-manager-versions",
  npmrc["manage-package-manager-versions"],
  "true"
);
expectValue(".npmrc package-manager-strict", npmrc["package-manager-strict"], "true");
expectValue("pnpm-workspace.yaml nodeVersion", unquote(workspace.nodeVersion), "22");
expectValue("pnpm-workspace.yaml saveExact", workspace.saveExact, "true");
expectLineSet(".gitignore", files[".gitignore"], [
  "node_modules/",
  "dist/",
  "coverage/",
  ".harness/",
  "*.tsbuildinfo",
  ".env",
  ".env.*",
  "!.env.example"
]);
expectLineSet(".ignore", files[".ignore"], [
  "node_modules/",
  "dist/",
  "coverage/",
  ".harness/",
  "*.tsbuildinfo",
  ".env",
  ".env.*",
  "!.env.example"
]);
expectLineSet(".prettierignore", files[".prettierignore"], [
  "dist/",
  "node_modules/",
  ".harness/",
  ".ignore",
  ".gitignore",
  ".env",
  ".env.*",
  "!.env.example"
]);
expectIncludes(
  ".gitignore env template exception",
  files[".gitignore"],
  ".env\n.env.*\n!.env.example"
);
expectIncludes(
  ".ignore env template exception",
  files[".ignore"],
  ".env\n.env.*\n!.env.example"
);
expectIncludes(
  ".prettierignore env template exception",
  files[".prettierignore"],
  ".env\n.env.*\n!.env.example"
);
expectLineSet(".env.example", files[".env.example"], [
  "ANTHROPIC_API_KEY=",
  "CURSOR_API_KEY=",
  "OPENAI_API_KEY=",
  "metaharness_TEST_CLAUDE=",
  "metaharness_TEST_CURSOR=",
  "metaharness_TEST_CODEX=",
  "metaharness_TEST_CODEX_APPSERVER="
]);
expectIncludes(".env.example", files[".env.example"], "repo does not auto-load");
expectIncludes(".env.example", files[".env.example"], "Keep these blank");
expectIncludes(".env.example", files[".env.example"], "normal credential-free");
expectIncludes(".env.example", files[".env.example"], "must be exactly 1 when enabled");

expectIncludes(
  ".github/workflows/ci.yml",
  files[".github/workflows/ci.yml"],
  "node-version: 22"
);
expectIncludes(
  ".github/workflows/release.yml",
  files[".github/workflows/release.yml"],
  "node-version: 22"
);
expectIncludes(
  ".github/workflows/ci.yml",
  files[".github/workflows/ci.yml"],
  "pnpm/action-setup@v4"
);
expectIncludes(
  ".github/workflows/release.yml",
  files[".github/workflows/release.yml"],
  "pnpm/action-setup@v4"
);
expectIncludes("eslint.config.mjs", files["eslint.config.mjs"], '"**/dist/**"');
expectIncludes("eslint.config.mjs", files["eslint.config.mjs"], '"**/node_modules/**"');
expectIncludes("eslint.config.mjs", files["eslint.config.mjs"], '".harness/**"');
expectIncludes("eslint.config.mjs", files["eslint.config.mjs"], '"coverage/**"');
expectIncludes("eslint.config.mjs", files["eslint.config.mjs"], '"pnpm-lock.yaml"');
expectIncludes("AGENTS.md", files["AGENTS.md"], "ProviderCapabilities");
expectIncludes("AGENTS.md", files["AGENTS.md"], "@anthropic-ai/claude-agent-sdk");
expectIncludes("AGENTS.md", files["AGENTS.md"], "@cursor/sdk");
expectIncludes("AGENTS.md", files["AGENTS.md"], "@openai/codex-sdk");
expectIncludes("AGENTS.md", files["AGENTS.md"], "Context7 MCP");
expectIncludes("AGENTS.md", files["AGENTS.md"], "pnpm check");
expectIncludes("AGENTS.md", files["AGENTS.md"], ".harness/");
expectIncludes("CONTRIBUTING.md", files["CONTRIBUTING.md"], "[SUPPORT.md](SUPPORT.md)");
expectIncludes(
  "CONTRIBUTING.md",
  files["CONTRIBUTING.md"],
  "[bug report template](.github/ISSUE_TEMPLATE/bug_report.md)"
);
expectIncludes(
  "CONTRIBUTING.md",
  files["CONTRIBUTING.md"],
  "[feature request template](.github/ISSUE_TEMPLATE/feature_request.md)"
);
expectIncludes(
  "CONTRIBUTING.md",
  files["CONTRIBUTING.md"],
  "issue-template chooser disables blank issues"
);
expectIncludes(
  "CONTRIBUTING.md",
  files["CONTRIBUTING.md"],
  "Do not paste API keys, tokens"
);
expectIncludes(
  "CONTRIBUTING.md",
  files["CONTRIBUTING.md"],
  "sensitive `.harness/` artifacts"
);
expectIncludes(
  "CONTRIBUTING.md",
  files["CONTRIBUTING.md"],
  "[pull request template](.github/PULL_REQUEST_TEMPLATE.md)"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "[SUPPORT.md](../../SUPPORT.md)"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "[Troubleshooting](../../docs/troubleshooting.md)"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "[SECURITY.md](../../SECURITY.md)"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "sensitive `.harness/` artifacts"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "pnpm --silent hk doctor --provider <provider> --json"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "pnpm --silent commands -- --json"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "Run id and `pnpm hk runs` output"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "Redacted `pnpm hk ledger show <run-id>` output"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "Redacted `pnpm hk stream <run-id>` output"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "`--cwd`, `--config`, and `storage.rootDir` used for the run and inspection"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/bug_report.md",
  files[".github/ISSUE_TEMPLATE/bug_report.md"],
  "`ProviderCapabilities`"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/config.yml",
  files[".github/ISSUE_TEMPLATE/config.yml"],
  "blank_issues_enabled: false"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/feature_request.md",
  files[".github/ISSUE_TEMPLATE/feature_request.md"],
  "new or changed `ProviderCapabilities` flag"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/feature_request.md",
  files[".github/ISSUE_TEMPLATE/feature_request.md"],
  "unsupported providers"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/feature_request.md",
  files[".github/ISSUE_TEMPLATE/feature_request.md"],
  "optional SDK impact"
);
expectIncludes(
  ".github/ISSUE_TEMPLATE/feature_request.md",
  files[".github/ISSUE_TEMPLATE/feature_request.md"],
  ".harness/"
);
expectIncludes(
  ".github/PULL_REQUEST_TEMPLATE.md",
  files[".github/PULL_REQUEST_TEMPLATE.md"],
  "ProviderCapabilities"
);
expectIncludes(
  ".github/PULL_REQUEST_TEMPLATE.md",
  files[".github/PULL_REQUEST_TEMPLATE.md"],
  "optional peer dependencies"
);
expectIncludes(
  ".github/PULL_REQUEST_TEMPLATE.md",
  files[".github/PULL_REQUEST_TEMPLATE.md"],
  "Raw provider events remain disabled by default"
);
expectIncludes(
  ".github/PULL_REQUEST_TEMPLATE.md",
  files[".github/PULL_REQUEST_TEMPLATE.md"],
  ".harness/"
);
expectIncludes(
  "SECURITY.md",
  files["SECURITY.md"],
  "[docs/security.md](docs/security.md)"
);
expectIncludes("SECURITY.md", files["SECURITY.md"], ".harness/");
expectIncludes("SECURITY.md", files["SECURITY.md"], "private security");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "pnpm setup:doctor");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "## Diagnostic Commands");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "node --version");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "pnpm --version");
expectIncludes(
  "SUPPORT.md",
  files["SUPPORT.md"],
  "pnpm --silent hk doctor --provider mock --json"
);
expectIncludes(
  "SUPPORT.md",
  files["SUPPORT.md"],
  "pnpm --silent hk doctor --provider <provider> --json"
);
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "pnpm hk runs");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "pnpm hk ledger show <run-id>");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "pnpm hk stream <run-id>");
expectIncludes(
  "SUPPORT.md",
  files["SUPPORT.md"],
  "If you used `--cwd`, `--config`, or a non-default `storage.rootDir`"
);
expectIncludes(
  "SUPPORT.md",
  files["SUPPORT.md"],
  "private prompts, transcripts, command output, paths, diffs, and provider"
);
expectIncludes(
  "SUPPORT.md",
  files["SUPPORT.md"],
  "metadata before sharing ledger or stream output"
);
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "pnpm --silent commands -- --json");
expectIncludes(
  "SUPPORT.md",
  files["SUPPORT.md"],
  "[docs/provider-capabilities.md](docs/provider-capabilities.md)"
);
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "`ProviderCapabilities`");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "sensitive `.harness/` artifacts");
expectIncludes("SUPPORT.md", files["SUPPORT.md"], "[SECURITY.md](SECURITY.md)");

if (failures.length > 0) {
  throw new Error(`Repository setup check failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  "Repository setup, editor defaults, env template, agent guidance, support guidance, issue and PR handoff guidance, security entry point, and ignore files are aligned."
);

async function readPnpmVersion() {
  try {
    const { stdout } = await execFile("pnpm", ["--version"], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024
    });
    return stdout.trim();
  } catch (error) {
    failures.push(`current pnpm version could not be read: ${formatError(error)}.`);
    return undefined;
  }
}

function parseKeyValueFile(source) {
  const values = {};

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("- ")) {
      continue;
    }

    const separator = line.includes("=") ? "=" : line.includes(":") ? ":" : undefined;
    if (!separator) {
      continue;
    }

    const [rawKey, ...rawValueParts] = line.split(separator);
    const key = rawKey?.trim();
    const value = rawValueParts.join(separator).trim();
    if (key) {
      values[key] = value;
    }
  }

  return values;
}

function unquote(value) {
  return value?.replace(/^["']|["']$/g, "");
}

function expectValue(label, actual, expected) {
  if (actual !== expected) {
    failures.push(
      `${label} should be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`
    );
  }
}

function expectVersionSatisfies(label, actual, range) {
  if (!actual || !range) {
    failures.push(
      `${label} should satisfy ${JSON.stringify(range)}, got ${JSON.stringify(actual)}.`
    );
    return;
  }

  const minimum = range.match(/^>=(\d+\.\d+\.\d+)$/)?.[1];
  if (!minimum) {
    failures.push(
      `${label} check only supports >=x.y.z ranges, got ${JSON.stringify(range)}.`
    );
    return;
  }

  if (compareVersions(actual, minimum) < 0) {
    failures.push(`${label} should satisfy ${range}, got ${actual}.`);
  }
}

function compareVersions(actual, minimum) {
  const actualParts = parseVersion(actual);
  const minimumParts = parseVersion(minimum);
  if (!actualParts || !minimumParts) {
    return -1;
  }

  for (let index = 0; index < 3; index += 1) {
    const actualPart = actualParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (actualPart !== minimumPart) {
      return actualPart > minimumPart ? 1 : -1;
    }
  }
  return 0;
}

function parseVersion(value) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    failures.push(`Version ${JSON.stringify(value)} should use x.y.z format.`);
    return undefined;
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function expectLineSet(label, source, expectedLines) {
  const actual = new Set(
    source
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );

  for (const expected of expectedLines) {
    if (!actual.has(expected)) {
      failures.push(`${label} should include ${JSON.stringify(expected)}.`);
    }
  }
}

function expectIncludes(label, source, expected) {
  if (!source.includes(expected)) {
    failures.push(`${label} should include ${JSON.stringify(expected)}.`);
  }
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
