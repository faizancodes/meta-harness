import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const repoRoot = resolve(import.meta.dirname, "..");
const execFile = promisify(execFileCallback);
const agentsPath = resolve(repoRoot, "AGENTS.md");
const conformancePath = resolve(repoRoot, "docs/conformance.md");
const contributingPath = resolve(repoRoot, "CONTRIBUTING.md");
const developmentPath = resolve(repoRoot, "docs/development.md");
const docsReadmePath = resolve(repoRoot, "docs/README.md");
const envExamplePath = resolve(repoRoot, ".env.example");
const examplesQuickstartPath = resolve(repoRoot, "examples/quickstart/README.md");
const packageManifestsTestPath = resolve(
  repoRoot,
  "packages/core/test/package-manifests.test.ts"
);
const policyPath = resolve(repoRoot, "docs/policy.md");
const readmePath = resolve(repoRoot, "README.md");
const commandGuideScriptPath = resolve(repoRoot, "scripts/show-command-guide.mjs");
const releaseCheckScriptPath = resolve(repoRoot, "scripts/check-release-workflow.mjs");
const setupCheckScriptPath = resolve(repoRoot, "scripts/check-repo-setup.mjs");
const testProjectScriptPath = resolve(repoRoot, "scripts/run-vitest-project.mjs");
const troubleshootingPath = resolve(repoRoot, "docs/troubleshooting.md");
const vitestConfigPath = resolve(repoRoot, "vitest.config.ts");
const packageJson = JSON.parse(await readFile(resolve(repoRoot, "package.json"), "utf8"));
const agents = await readFile(agentsPath, "utf8");
const conformance = await readFile(conformancePath, "utf8");
const contributing = await readFile(contributingPath, "utf8");
const development = await readFile(developmentPath, "utf8");
const docsReadme = await readFile(docsReadmePath, "utf8");
const envExample = await readFile(envExamplePath, "utf8");
const examplesQuickstart = await readFile(examplesQuickstartPath, "utf8");
const packageManifestsTest = await readFile(packageManifestsTestPath, "utf8");
const policy = await readFile(policyPath, "utf8");
const readme = await readFile(readmePath, "utf8");
const releaseCheckScript = await readFile(releaseCheckScriptPath, "utf8");
const setupCheckScript = await readFile(setupCheckScriptPath, "utf8");
const testProjectScript = await readFile(testProjectScriptPath, "utf8");
const troubleshooting = await readFile(troubleshootingPath, "utf8");
const vitestConfig = await readFile(vitestConfigPath, "utf8");
const failures = [];

const expectedRecoveryRows = [
  {
    command: "pnpm setup:check",
    label: "Repository setup or ignore files drift"
  },
  {
    command: "pnpm setup:doctor",
    label: "Fresh clone doctor fails"
  },
  {
    command: "pnpm lint",
    label: "ESLint fails"
  },
  {
    command: "pnpm typecheck",
    label: "TypeScript package checks fail"
  },
  {
    command: "pnpm test",
    label: "Test suite or conformance fails"
  },
  {
    command: "pnpm test:live",
    label: "Live provider gate is ignored"
  },
  {
    command: "pnpm format:write",
    label: "Formatting check fails"
  },
  {
    command: "pnpm generated:write",
    label: "Generated docs and schemas drift"
  },
  {
    command: "pnpm artifacts:clean -- --dry-run",
    label: "Local `.harness` artifacts accumulate"
  },
  {
    command: "pnpm clean -- --dry-run",
    label: "Ignored local outputs accumulate"
  },
  {
    command: "pnpm docs:capabilities",
    label: "Generated capability docs drift"
  },
  {
    command: "pnpm schemas:generate",
    label: "Generated JSON Schema drift"
  },
  {
    command: "pnpm cli:help:check",
    label: "CLI help output drift"
  },
  {
    command: "pnpm docs:check",
    label: "Documentation aggregate fails"
  },
  {
    command: "pnpm docs:cli:check",
    label: "CLI reference docs drift"
  },
  {
    command: "pnpm docs:validation:check",
    label: "Validation guidance drifts"
  },
  {
    command: "pnpm docs:links:check",
    label: "Markdown links, docs index, or package maps fail"
  },
  {
    command: "pnpm docs:sources:check",
    label: "Verified source docs drift"
  },
  {
    command: "pnpm docs:error-codes:check",
    label: "Error code docs drift"
  },
  {
    command: "pnpm docs:policy:check",
    label: "Policy docs/examples fail"
  },
  {
    command: "pnpm docs:snippets:check",
    label: "TypeScript docs/examples fail"
  },
  {
    command: "pnpm examples:docs:check",
    label: "Example docs drift"
  },
  {
    command: "pnpm examples:smoke",
    label: "Credential-free example smoke fails"
  },
  {
    command: "pnpm package:check",
    label: "Package tarball contents fail"
  },
  {
    command: "pnpm consumer:smoke",
    label: "Consumer install smoke fails"
  },
  {
    command: "pnpm release:check",
    label: "Release workflow check fails"
  },
  {
    command: "pnpm check",
    label: "Unknown local validation issue"
  }
];

const expectedReadmeCommands = [
  ...Object.keys(packageJson.scripts ?? {}).map(readmeCommandForScript),
  "pnpm hk doctor --provider codex",
  "pnpm hk docs capabilities"
];

const expectedReadmeCommandGuideRows = [
  {
    label: "Find repo commands",
    commands: ["pnpm commands"]
  },
  {
    label: "First local setup, editor, agent, and ignore check",
    commands: ["pnpm setup:check"]
  },
  {
    label: "Fresh clone CLI doctor",
    commands: ["pnpm setup:doctor"]
  },
  {
    label: "Normal local validation",
    commands: ["pnpm check"]
  },
  {
    label: "PR, release, or handoff validation",
    commands: ["pnpm ci:check"]
  },
  {
    label: "Targeted tests",
    commands: ["pnpm test:project -- cli", "pnpm --filter @metaharness/cli test"]
  },
  {
    label: "SDK quickstart or examples",
    commands: ["pnpm example:sdk", "pnpm examples:smoke"]
  },
  {
    label: "CLI changes",
    commands: ["pnpm cli:help:check", "pnpm docs:cli:check"]
  },
  {
    label: "Docs and examples",
    commands: ["pnpm docs:check"]
  },
  {
    label: "Generated artifacts",
    commands: ["pnpm generated:write", "pnpm generated:check"]
  },
  {
    label: "Local run artifacts",
    commands: ["pnpm artifacts:clean -- --dry-run"]
  },
  {
    label: "All ignored local outputs",
    commands: ["pnpm clean -- --dry-run"]
  },
  {
    label: "Package or release changes",
    commands: ["pnpm package:check", "pnpm consumer:smoke", "pnpm release:check"]
  }
];

const expectedContributingCommands = [
  "pnpm artifacts:clean -- --dry-run",
  "pnpm check",
  "pnpm ci:check",
  "pnpm clean -- --dry-run",
  "pnpm commands",
  "pnpm setup:check",
  "pnpm setup:doctor",
  "pnpm lint",
  "pnpm typecheck",
  "pnpm typecheck:examples",
  "pnpm test",
  "pnpm test:project -- cli",
  "pnpm test:integration",
  "pnpm build",
  "pnpm cli:help:check",
  "pnpm docs:check",
  "pnpm docs:cli:check",
  "pnpm docs:validation:check",
  "pnpm docs:links:check",
  "pnpm docs:sources:check",
  "pnpm docs:error-codes:check",
  "pnpm docs:policy:check",
  "pnpm docs:snippets:check",
  "pnpm examples:docs:check",
  "pnpm example:sdk",
  "pnpm package:check",
  "pnpm generated:check",
  "pnpm generated:write",
  "pnpm examples:smoke",
  "pnpm consumer:smoke",
  "pnpm release:check",
  "pnpm format",
  "pnpm format:write"
];

const expectedContributingRows = [
  {
    label: "SDK or core behavior",
    commands: ["pnpm typecheck", "pnpm test", "pnpm check"]
  },
  {
    label: "CLI commands, help, or reference",
    commands: ["pnpm build", "pnpm cli:help:check", "pnpm docs:cli:check", "pnpm check"]
  },
  {
    label: "Public TypeScript examples",
    commands: ["pnpm docs:snippets:check", "pnpm typecheck:examples", "pnpm check"]
  },
  {
    label: "Policy docs or examples",
    commands: ["pnpm docs:policy:check", "pnpm docs:snippets:check", "pnpm check"]
  },
  {
    label: "Error or diagnostic codes",
    commands: ["pnpm docs:error-codes:check", "pnpm docs:links:check", "pnpm check"]
  },
  {
    label: "Docs or examples",
    commands: ["pnpm docs:check", "pnpm check"]
  },
  {
    label: "Generated schemas or capabilities",
    commands: ["pnpm generated:check", "pnpm generated:write"]
  },
  {
    label: "Package manifests or release",
    commands: ["pnpm package:check", "pnpm consumer:smoke", "pnpm release:check"]
  },
  {
    label: "Broad or handoff-ready work",
    commands: ["pnpm ci:check"]
  }
];

const expectedDevelopmentChangeMapRows = [
  {
    checks: ["pnpm test"],
    docs: ["docs/sdk.md", "docs/event-model.md", "docs/ledger.md", "docs/handoff.md"],
    label: "Harness lifecycle, events, storage, and ledgers",
    starts: [
      "packages/core/src/create-harness.ts",
      "packages/core/src/event-recorder.ts",
      "packages/core/src/run-store.ts",
      "packages/core/src/session-ledger.ts"
    ]
  },
  {
    checks: ["pnpm generated:check"],
    docs: ["docs/configuration.md", "schemas/"],
    label: "Config fields, config validation, and schemas",
    starts: [
      "packages/core/src/config-validation.ts",
      "packages/core/src/json-schemas.ts",
      "packages/cli/src/load-config.ts"
    ]
  },
  {
    checks: ["pnpm cli:help:check", "pnpm docs:cli:check"],
    docs: ["docs/cli.md", "packages/cli/README.md", "docs/troubleshooting.md"],
    label: "CLI commands, help, and artifact commands",
    starts: [
      "packages/cli/src/main.ts",
      "packages/cli/src/commands/",
      "packages/cli/src/run-artifacts.ts"
    ]
  },
  {
    checks: ["pnpm generated:check"],
    docs: ["docs/adapters.md", "docs/provider-capabilities.md", "package README"],
    label: "Provider adapter capabilities, config, and events",
    starts: [
      "packages/*/src/*-adapter.ts",
      "packages/*/src/map-config.ts",
      "packages/*/src/map-events.ts",
      "packages/core/src/types/capabilities.ts"
    ]
  },
  {
    checks: ["pnpm docs:policy:check"],
    docs: ["docs/policy.md", "docs/security.md", "metaharness.policy.yaml"],
    label: "Policy parsing, command checks, and redaction",
    starts: [
      "packages/policy/src/",
      "packages/core/src/redact.ts",
      "packages/core/src/verification.ts"
    ]
  },
  {
    checks: ["pnpm package:check", "pnpm release:check"],
    docs: ["docs/github-action.md", "packages/github-action/README.md"],
    label: "GitHub Action workflow behavior",
    starts: ["packages/github-action/src/index.ts", "packages/github-action/action.yml"]
  },
  {
    checks: ["pnpm docs:check", "pnpm examples:smoke", "pnpm consumer:smoke"],
    docs: ["examples/README.md", "example READMEs", "package READMEs"],
    label: "Public examples and onboarding paths",
    starts: ["examples/", "README.md", "CONTRIBUTING.md"]
  },
  {
    checks: ["pnpm package:check", "pnpm consumer:smoke", "pnpm release:check"],
    docs: ["package READMEs", "README.md", "docs/development.md"],
    label: "Package manifests, packing, and release metadata",
    starts: [
      "package `package.json` files",
      "package.json",
      ".changeset/config.json",
      ".github/workflows/release.yml",
      "scripts/check-package-packing.mjs"
    ]
  },
  {
    checks: [
      "pnpm docs:error-codes:check",
      "pnpm docs:links:check",
      "pnpm docs:validation:check"
    ],
    docs: ["docs/error-codes.md", "docs/troubleshooting.md", "docs/cli.md"],
    label: "Diagnostics, typed errors, and recovery guidance",
    starts: ["packages/*/src", "docs/error-codes.md", "docs/troubleshooting.md"]
  }
];

const expectedGeneratedArtifactRows = [
  {
    artifact: "docs/provider-capabilities.md",
    command: "pnpm docs:capabilities",
    source: "docsCapabilitiesCommand()"
  },
  {
    artifact: "schemas/metaharness.config.schema.json",
    command: "pnpm schemas:generate",
    source: "configJsonSchema()"
  },
  {
    artifact: "schemas/metaharness.policy.schema.json",
    command: "pnpm schemas:generate",
    source: "policyJsonSchema()"
  },
  {
    artifact: "schemas/event.schema.json",
    command: "pnpm schemas:generate",
    source: "eventJsonSchema()"
  },
  {
    artifact: "schemas/session-ledger.schema.json",
    command: "pnpm schemas:generate",
    source: "sessionLedgerJsonSchema()"
  },
  {
    artifact: "Package `dist/` directories",
    command: "pnpm build",
    source: "tsup"
  },
  {
    artifact: ".harness/",
    command: "create a run; do not commit",
    source: "Local `hk` and SDK runs"
  }
];

const expectedVitestProjects = [
  {
    packageDir: "packages/core",
    packageName: "@metaharness/core",
    project: "core"
  },
  {
    packageDir: "packages/adapter-mock",
    packageName: "@metaharness/adapter-mock",
    project: "adapter-mock"
  },
  {
    packageDir: "packages/policy",
    packageName: "@metaharness/policy",
    project: "policy"
  },
  {
    packageDir: "packages/telemetry",
    packageName: "@metaharness/telemetry",
    project: "telemetry"
  },
  {
    packageDir: "packages/claude",
    packageName: "@metaharness/claude",
    project: "claude"
  },
  {
    packageDir: "packages/cursor",
    packageName: "@metaharness/cursor",
    project: "cursor"
  },
  {
    packageDir: "packages/codex",
    packageName: "@metaharness/codex",
    project: "codex"
  },
  {
    packageDir: "packages/cli",
    packageName: "@metaharness/cli",
    project: "cli"
  },
  {
    packageDir: "packages/github-action",
    packageName: "@metaharness/github-action",
    project: "github-action"
  }
];

for (const row of expectedRecoveryRows) {
  expectScriptExists(row.command);
  if (!troubleshooting.includes(row.label)) {
    failures.push(`docs/troubleshooting.md should include "${row.label}".`);
  }
  if (!troubleshooting.includes(row.command)) {
    failures.push(
      `docs/troubleshooting.md should list ${row.command} as the first command for ${row.label}.`
    );
  }
}

if (!troubleshooting.includes("pnpm ci:check")) {
  failures.push(
    "docs/troubleshooting.md should point unknown broad validation issues at pnpm ci:check."
  );
}
expectScriptExists("pnpm ci:check");
expectConformanceExpansion("pnpm ci:check");
expectConformanceExpansion("pnpm check");
expectConformanceExpansion("pnpm docs:check");
expectReadmeCommonCommands();
await expectCommandGuide();
expectTroubleshootingEscalationGuidance();
expectSetupCheckGuidance();
expectAgentGuidance();
expectDevelopmentChangeMap();
expectDevelopmentRootScripts();
expectPackageManifestGuidance();
expectContributingChangeMapGuidance();
expectContributingValidationGuide();
await expectTargetedTestGuidance();
expectProviderSetupGuidance();
expectPolicyEnvTemplateGuidance();
expectReleaseGuidance();
await expectLiveProviderGuidance();
expectConsumerSmokeGuidance();
expectGeneratedArtifactGuidance();
await expectArtifactCleanupGuidance();
await expectWorkspaceCleanupGuidance();
expectDoctorGuidance();
expectFirstHourOnboardingGuidance();

if (failures.length > 0) {
  throw new Error(`Validation guidance check failed:\n- ${failures.join("\n- ")}`);
}

console.log(
  "Validation guidance lists the expected narrow checks, command-guide guidance, change-map guidance, first-hour onboarding guidance, contributor onboarding guidance, targeted-test guidance, generated-artifact and cleanup guidance, script-derived README/development/contributor commands, and command expansions."
);

function expectScriptExists(command) {
  const scriptName = command.match(/^pnpm\s+(\S+)/)?.[1] ?? command;
  if (packageJson.scripts?.[scriptName]) {
    return;
  }
  failures.push(`package.json should define a ${JSON.stringify(scriptName)} script.`);
}

function readmeCommandForScript(scriptName) {
  if (scriptName === "artifacts:clean") {
    return "pnpm artifacts:clean -- --dry-run";
  }
  if (scriptName === "clean") {
    return "pnpm clean -- --dry-run";
  }
  if (scriptName === "hk") {
    return "pnpm hk --help";
  }
  if (scriptName === "test:project") {
    return "pnpm test:project -- cli";
  }
  return `pnpm ${scriptName}`;
}

function expectConformanceExpansion(command) {
  const scriptName = command.replace(/^pnpm\s+/, "");
  const script = packageJson.scripts?.[scriptName];
  if (!script) {
    failures.push(`package.json should define a ${JSON.stringify(scriptName)} script.`);
    return;
  }
  const commands = script
    .split("&&")
    .map((part) => part.trim())
    .filter(Boolean);
  const expectedBlock = [
    `\`${command}\` expands to:`,
    "",
    "```bash",
    ...commands,
    "```"
  ].join("\n");
  if (!conformance.includes(expectedBlock)) {
    failures.push(
      `docs/conformance.md should list the current ${command} expansion exactly.`
    );
  }
}

function expectSetupCheckGuidance() {
  expectContainsAll("README.md setup check guidance", readme.replace(/\s+/g, " "), [
    "First local setup, editor, agent, and ignore check",
    "`pnpm setup:check` verifies the active Node and pnpm versions",
    "editor defaults",
    "agent guidance",
    "the env template",
    "toolchain pins",
    "ignore hygiene",
    ".env` secret files",
    "local `.harness` artifacts"
  ]);

  expectContainsAll(
    "docs/development.md setup check guidance",
    development.replace(/\s+/g, " "),
    [
      "`pnpm setup:check` validates the active Node and pnpm versions",
      "Verify active Node/pnpm versions, editor defaults, agent guidance, workspace, CI, and ignores",
      "checks the active Node and pnpm versions",
      ".editorconfig",
      ".env.example",
      "AGENTS.md",
      ".gitignore",
      ".prettierignore",
      "ESLint ignores",
      "editor-default",
      "env-template",
      "agent-guidance",
      "artifact-ignore drift"
    ]
  );

  expectContainsAll(
    "CONTRIBUTING.md setup check guidance",
    contributing.replace(/\s+/g, " "),
    [
      "`pnpm setup:check` verifies the active Node and pnpm versions",
      ".editorconfig",
      ".env.example",
      "AGENTS.md",
      ".npmrc",
      "ignore-hygiene checks",
      "env-template",
      "repository setup, editor defaults, env template, agent guidance, and ignore files"
    ]
  );

  expectContainsAll(
    "docs/troubleshooting.md setup check guidance",
    troubleshooting.replace(/\s+/g, " "),
    [
      "Node version check fails",
      "active Node process",
      "pnpm version check fails",
      "Use pnpm 9.13 or newer",
      "corepack enable"
    ]
  );

  expectContainsAll("scripts/check-repo-setup.mjs runtime checks", setupCheckScript, [
    "process.version",
    "pnpm",
    "--version",
    "current Node version",
    "current pnpm version",
    ".editorconfig",
    "editorConfig",
    ".env.example",
    "repo does not auto-load",
    "AGENTS.md",
    "agent guidance",
    "indent_style",
    "expectVersionSatisfies"
  ]);
}

function expectTroubleshootingEscalationGuidance() {
  expectContainsAll(
    "docs/troubleshooting.md unresolved issue escalation guidance",
    troubleshooting.replace(/\s+/g, " "),
    [
      "## When This Does Not Resolve It",
      "[Support](../SUPPORT.md)",
      "[bug report template](../.github/ISSUE_TEMPLATE/bug_report.md)",
      "smallest command, SDK snippet, config shape, or example directory",
      "provider id and provider SDK package version",
      "Node and pnpm versions",
      "redacted stderr, JSON output, or `pnpm setup:doctor` result",
      "`ProviderCapabilities` flag",
      "sensitive `.harness/` artifacts",
      "[Security policy](../SECURITY.md)"
    ]
  );
}

function expectAgentGuidance() {
  expectContainsAll("AGENTS.md agent guidance", agents, [
    "ProviderCapabilities",
    "@anthropic-ai/claude-agent-sdk",
    "@cursor/sdk",
    "@openai/codex-sdk",
    "optional peer dependencies",
    "MCP",
    "SessionLedger",
    ".harness/",
    "Context7 MCP",
    "resolve-library-id",
    "pnpm build",
    "pnpm --silent commands -- --json",
    "pnpm check",
    "pnpm ci:check",
    "Live provider conformance is opt-in"
  ]);

  expectContainsAll("CONTRIBUTING.md agent guidance", contributing.replace(/\s+/g, " "), [
    "AI coding agents should also read [AGENTS.md](AGENTS.md)",
    "provider-capability rules",
    "Context7 documentation workflow",
    "sensitive artifact handling",
    "validation gates"
  ]);

  expectContainsAll(
    "docs/development.md agent guidance",
    development.replace(/\s+/g, " "),
    [
      "AI coding agents should read the root [`AGENTS.md`](../AGENTS.md)",
      "provider capability rules",
      "Context7 documentation usage",
      "repo-local CLI build expectations",
      "sensitive artifact handling",
      "validation gates"
    ]
  );
}

async function expectCommandGuide() {
  if (packageJson.scripts?.commands !== "node scripts/show-command-guide.mjs") {
    failures.push(
      "package.json commands script should run node scripts/show-command-guide.mjs."
    );
  }

  expectContainsAll("README.md command guide", readme.replace(/\s+/g, " "), [
    "Find repo commands",
    "`pnpm commands`",
    "terminal-first guide",
    "setup, mock smoke run, artifact inspection, validation, iteration, examples, packaging, formatting, release-intent, live-provider, and support commands",
    "`pnpm --silent commands -- --json`",
    "example and support references",
    "support references",
    "parseable JSON"
  ]);

  expectContainsAll(
    "docs/development.md command guide",
    development.replace(/\s+/g, " "),
    [
      "`pnpm commands`",
      "short terminal guide",
      "first-hour setup",
      "mock smoke run",
      "artifact inspection",
      "examples",
      "formatting",
      "release-intent",
      "live-provider, and support commands",
      "`pnpm --silent commands -- --json`",
      "example and support references without scraping terminal text"
    ]
  );

  expectContainsAll("CONTRIBUTING.md command guide", contributing, ["pnpm commands"]);

  const { stdout } = await execFile(process.execPath, [commandGuideScriptPath], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024
  });
  expectContainsAll("scripts/show-command-guide.mjs", stdout, [
    "metaharness command guide",
    "Start Here",
    "pnpm setup:doctor",
    'pnpm hk run --provider mock --task "Smoke test"',
    "create a credential-free run artifact",
    "pnpm hk runs",
    "list recent run ids and confirm the newest run",
    "pnpm hk stream latest",
    "replay the newest run's portable event log",
    "pnpm hk ledger show latest",
    "inspect the newest run summary and artifacts",
    "Validate",
    "pnpm check",
    "fast runtime, editor, agent-guidance, setup, and ignore-hygiene check",
    "Iterate",
    "pnpm test:project -- --help",
    "pnpm test:project -- cli",
    "Learn By Example",
    "pnpm example:sdk",
    "run the credential-free SDK mock example",
    "pnpm examples:smoke",
    "pnpm examples:docs:check",
    "Artifacts And Packaging",
    "pnpm artifacts:clean -- --dry-run",
    "pnpm clean -- --dry-run",
    "Format",
    "pnpm format",
    "pnpm format:write",
    "pnpm format:write docs/sdk.md",
    "Release Intent",
    "pnpm changeset",
    "pnpm release:check",
    "verify release scripts, Changesets config, and workflow wiring",
    "Live Providers",
    "pnpm test:live -- --help",
    "Support",
    "pnpm hk doctor --provider mock",
    "pnpm --silent hk doctor --provider mock --json",
    "parseable doctor diagnostics for issue reports",
    "README.md#common-commands",
    "docs/development.md#root-scripts",
    "examples/README.md",
    "docs/troubleshooting.md",
    "docs/error-codes.md",
    "SUPPORT.md"
  ]);

  const { stdout: jsonOutput } = await execFile(
    process.execPath,
    [commandGuideScriptPath, "--json"],
    {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024
    }
  );
  expectCommandGuideJson(JSON.parse(jsonOutput));

  const { stdout: helpOutput } = await execFile(
    process.execPath,
    [commandGuideScriptPath, "--help"],
    {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024
    }
  );
  expectContainsAll("scripts/show-command-guide.mjs --help", helpOutput, [
    "Usage: pnpm commands",
    "Prints the short metaharness command guide",
    "Use --json for machine-readable command discovery.",
    "pnpm commands -- --help",
    "pnpm --silent commands -- --json"
  ]);
}

function expectCommandGuideJson(guide) {
  if (guide?.name !== "metaharness command guide") {
    failures.push("scripts/show-command-guide.mjs --json should include the guide name.");
  }

  const sections = Array.isArray(guide?.sections) ? guide.sections : [];
  const examplesSection = sections.find(
    (section) => section?.title === "Learn By Example"
  );
  const formatSection = sections.find((section) => section?.title === "Format");
  const releaseSection = sections.find((section) => section?.title === "Release Intent");
  const supportSection = sections.find((section) => section?.title === "Support");
  const commands = sections.flatMap((section) =>
    Array.isArray(section?.commands) ? section.commands : []
  );
  const commandNames = new Set(commands.map((command) => command?.command));

  for (const command of [
    "pnpm setup:doctor",
    'pnpm hk run --provider mock --task "Smoke test"',
    "pnpm hk runs",
    "pnpm hk stream latest",
    "pnpm hk ledger show latest",
    "pnpm check",
    "pnpm ci:check",
    "pnpm test:project -- --help",
    "pnpm example:sdk",
    "pnpm examples:smoke",
    "pnpm examples:docs:check",
    "pnpm format",
    "pnpm format:write",
    "pnpm format:write docs/sdk.md",
    "pnpm changeset",
    "pnpm release:check",
    "pnpm test:live -- --help",
    "pnpm hk doctor --provider mock",
    "pnpm --silent hk doctor --provider mock --json"
  ]) {
    if (!commandNames.has(command)) {
      failures.push(`scripts/show-command-guide.mjs --json should include ${command}.`);
    }
  }

  if (!releaseSection) {
    failures.push(
      "scripts/show-command-guide.mjs --json should include a Release Intent section."
    );
  }

  if (!examplesSection) {
    failures.push(
      "scripts/show-command-guide.mjs --json should include a Learn By Example section."
    );
  }

  if (!formatSection) {
    failures.push(
      "scripts/show-command-guide.mjs --json should include a Format section."
    );
  }

  const scopedFormatCommand = commands.find(
    (command) => command?.command === "pnpm format:write docs/sdk.md"
  );
  if (
    scopedFormatCommand?.description !== "format one path or a short changed-file list"
  ) {
    failures.push(
      "scripts/show-command-guide.mjs --json should describe scoped formatting."
    );
  }

  const firstRunCommand = commands.find(
    (command) => command?.command === 'pnpm hk run --provider mock --task "Smoke test"'
  );
  if (firstRunCommand?.description !== "create a credential-free run artifact") {
    failures.push(
      "scripts/show-command-guide.mjs --json should describe the first mock run as creating a credential-free run artifact."
    );
  }

  const firstRunsCommand = commands.find(
    (command) => command?.command === "pnpm hk runs"
  );
  if (
    firstRunsCommand?.description !== "list recent run ids and confirm the newest run"
  ) {
    failures.push(
      "scripts/show-command-guide.mjs --json should describe run listing for first-hour onboarding."
    );
  }

  const firstStreamCommand = commands.find(
    (command) => command?.command === "pnpm hk stream latest"
  );
  if (firstStreamCommand?.description !== "replay the newest run's portable event log") {
    failures.push(
      "scripts/show-command-guide.mjs --json should describe latest event-log replay for first-hour onboarding."
    );
  }

  const firstArtifactCommand = commands.find(
    (command) => command?.command === "pnpm hk ledger show latest"
  );
  if (
    firstArtifactCommand?.description !== "inspect the newest run summary and artifacts"
  ) {
    failures.push(
      "scripts/show-command-guide.mjs --json should describe latest ledger inspection for first-hour onboarding."
    );
  }

  if (!supportSection) {
    failures.push(
      "scripts/show-command-guide.mjs --json should include a Support section."
    );
  }

  const releaseCheckCommand = commands.find(
    (command) => command?.command === "pnpm release:check"
  );
  if (
    releaseCheckCommand?.description !==
    "verify release scripts, Changesets config, and workflow wiring"
  ) {
    failures.push(
      "scripts/show-command-guide.mjs --json should describe pnpm release:check as verifying release scripts, Changesets config, and workflow wiring."
    );
  }

  for (const reference of [
    "README.md#common-commands",
    "docs/development.md#root-scripts",
    "examples/README.md",
    "docs/troubleshooting.md",
    "docs/error-codes.md",
    "SUPPORT.md"
  ]) {
    if (!guide?.references?.includes(reference)) {
      failures.push(
        `scripts/show-command-guide.mjs --json should include reference ${reference}.`
      );
    }
  }
}

function expectReadmeCommonCommands() {
  expectReadmeCommandGuide();

  const readmeLines = new Set(readme.split(/\r?\n/).map((line) => line.trim()));
  for (const command of expectedReadmeCommands) {
    expectPnpmCommandScriptExists(command);
    if (!readmeLines.has(command)) {
      failures.push(`README.md Common Commands should include ${command}.`);
    }
  }
}

function expectReadmeCommandGuide() {
  const commonCommands = markdownSection(readme, "Common Commands");
  if (!commonCommands) {
    failures.push('README.md should include a "## Common Commands" section.');
    return;
  }

  const rows = tableRows(commonCommands);
  for (const expectedRow of expectedReadmeCommandGuideRows) {
    const row = rows.find((cells) => cells[0] === expectedRow.label);
    if (!row) {
      failures.push(
        `README.md Common Commands guide should include "${expectedRow.label}".`
      );
      continue;
    }

    const rowText = row.join(" ");
    for (const command of expectedRow.commands) {
      expectPnpmCommandScriptExists(command);
      if (!rowText.includes(`\`${command}\``)) {
        failures.push(
          `README.md Common Commands guide row "${expectedRow.label}" should include ${command}.`
        );
      }
    }
  }
}

function expectDevelopmentRootScripts() {
  const rootScripts = markdownSection(development, "Root Scripts");
  if (!rootScripts) {
    failures.push('docs/development.md should include a "## Root Scripts" section.');
    return;
  }

  const expectedDevelopmentCommands = [
    ...expectedReadmeCommands.filter(
      (command) =>
        command !== "pnpm hk docs capabilities" &&
        command !== "pnpm hk doctor --provider codex"
    ),
    "pnpm release:publish",
    "pnpm hk doctor --provider mock"
  ];

  for (const command of expectedDevelopmentCommands) {
    expectPnpmCommandScriptExists(command);
    if (!rootScripts.includes(`| \`${command}\``)) {
      failures.push(`docs/development.md Root Scripts should include ${command}.`);
    }
  }

  expectContainsAll("formatting path guidance", rootScripts, [
    "`pnpm format`",
    "`pnpm format:write`",
    "append paths to limit scope"
  ]);
  expectContainsAll("README.md formatting path guidance", readme, [
    "`pnpm format` and `pnpm format:write` default to the full repo",
    "`pnpm format:write docs/sdk.md`"
  ]);
  expectContainsAll("CONTRIBUTING.md formatting path guidance", contributing, [
    "Use `pnpm format:write` only when you want Prettier to rewrite files",
    "`pnpm format:write docs/sdk.md`"
  ]);
  if (packageJson.scripts?.format !== "node scripts/run-prettier.mjs --check") {
    failures.push("package.json format script should use scripts/run-prettier.mjs.");
  }
  if (packageJson.scripts?.["format:write"] !== "node scripts/run-prettier.mjs --write") {
    failures.push(
      "package.json format:write script should use scripts/run-prettier.mjs."
    );
  }
}

function expectDevelopmentChangeMap() {
  const changeMap = markdownSection(development, "Change Map");
  if (!changeMap) {
    failures.push('docs/development.md should include a "## Change Map" section.');
    return;
  }

  expectContainsAll("docs/development.md Change Map intro", changeMap, [
    "edit surface",
    "nearby tests",
    "public docs",
    "`pnpm check`",
    "`pnpm ci:check`"
  ]);

  const rows = tableRows(changeMap);
  for (const expectedRow of expectedDevelopmentChangeMapRows) {
    const row = rows.find((cells) => cells[0] === expectedRow.label);
    if (!row) {
      failures.push(
        `docs/development.md Change Map should include "${expectedRow.label}".`
      );
      continue;
    }

    const rowText = row.join(" ");
    for (const snippet of expectedRow.starts) {
      if (!rowText.includes(snippet)) {
        failures.push(
          `docs/development.md Change Map row "${expectedRow.label}" should include ${snippet}.`
        );
      }
    }
    for (const command of expectedRow.checks) {
      expectPnpmCommandScriptExists(command);
      if (!rowText.includes(command)) {
        failures.push(
          `docs/development.md Change Map row "${expectedRow.label}" should include ${command}.`
        );
      }
    }
    for (const doc of expectedRow.docs) {
      if (!rowText.includes(doc)) {
        failures.push(
          `docs/development.md Change Map row "${expectedRow.label}" should include ${doc}.`
        );
      }
    }
  }
}

function expectPackageManifestGuidance() {
  const packageManifests = markdownSection(development, "Package Manifests");
  if (!packageManifests) {
    failures.push('docs/development.md should include a "## Package Manifests" section.');
    return;
  }

  expectContainsAll("docs/development.md Package Manifests", packageManifests, [
    "human-readable",
    "`description`",
    "searchable `keywords`",
    "`README.md`",
    "`publishConfig.access = public`",
    "package READMEs",
    "publishable tarballs"
  ]);

  expectContainsAll(
    "packages/core/test/package-manifests.test.ts keywords",
    packageManifestsTest,
    ["commonPackageKeywords", "packageSpecificKeywords", "keywords must include"]
  );
}

function expectContributingChangeMapGuidance() {
  const beforeEditing = markdownSection(contributing, "Before Editing");
  if (!beforeEditing) {
    failures.push('CONTRIBUTING.md should include a "## Before Editing" section.');
    return;
  }

  expectContainsAll("CONTRIBUTING.md Before Editing", beforeEditing, [
    "[Development change map](docs/development.md#change-map)",
    "common change areas",
    "source files",
    "nearby tests or guards",
    "public docs to keep in sync",
    "narrow validation command"
  ]);
}

function expectContributingValidationGuide() {
  const validation = markdownSection(contributing, "Validation");
  if (!validation) {
    failures.push('CONTRIBUTING.md should include a "## Validation" section.');
    return;
  }

  for (const command of expectedContributingCommands) {
    expectPnpmCommandScriptExists(command);
    if (!validation.includes(command)) {
      failures.push(`CONTRIBUTING.md Validation should include ${command}.`);
    }
  }

  const rows = tableRows(validation);
  for (const expectedRow of expectedContributingRows) {
    const row = rows.find((cells) => cells[0] === expectedRow.label);
    if (!row) {
      failures.push(
        `CONTRIBUTING.md Validation change-type table should include "${expectedRow.label}".`
      );
      continue;
    }

    const checks = row[1] ?? "";
    for (const command of expectedRow.commands) {
      expectPnpmCommandScriptExists(command);
      if (!checks.includes(command)) {
        failures.push(
          `CONTRIBUTING.md Validation row "${expectedRow.label}" should include ${command}.`
        );
      }
    }
  }
}

function expectReleaseGuidance() {
  expectContainsAll(
    "scripts/check-release-workflow.mjs Changesets config guard",
    releaseCheckScript,
    [
      ".changeset/config.json",
      "expectChangesetConfig",
      "baseBranch",
      "main",
      "access",
      "public",
      "privatePackages.version",
      "updateInternalDependencies",
      "patch"
    ]
  );

  expectContainsAll(
    "docs/development.md release guidance",
    development.replace(/\s+/g, " "),
    [
      ".changeset/config.json",
      "public npm access",
      "`main` as the base branch",
      "patch-level internal dependency updates",
      "`pnpm release:check` after editing `.changeset/config.json`",
      "Verify release scripts, Changesets config, and workflow wiring"
    ]
  );

  expectContainsAll(
    "CONTRIBUTING.md release guidance",
    contributing.replace(/\s+/g, " "),
    [
      ".changeset/config.json",
      "run the release wiring check first",
      "pnpm release:check",
      "pnpm ci:check"
    ]
  );
}

async function expectTargetedTestGuidance() {
  const targetedTests = markdownSection(development, "Targeted Test Loops");
  if (!targetedTests) {
    failures.push(
      'docs/development.md should include a "## Targeted Test Loops" section.'
    );
    return;
  }

  const normalizedTargetedTests = targetedTests.replace(/\s+/g, " ");
  expectContainsAll("docs/development.md Targeted Test Loops", normalizedTargetedTests, [
    "Run one package's test script",
    "`pnpm --filter @metaharness/cli test`",
    "List Vitest projects and examples",
    "`pnpm test:project -- --help`",
    "Run one Vitest project without build",
    "`pnpm test:project -- cli`",
    "`pnpm test:project -- cli packages/cli/test/cli.test.ts`",
    '`pnpm test:project -- cli packages/cli/test/cli.test.ts -t "run command"`',
    "`pnpm test:integration`",
    "`metaharness_TEST_CODEX=1 OPENAI_API_KEY=... pnpm test:live`",
    "`pnpm check`",
    "`pnpm ci:check`",
    "thin wrapper around",
    "validates the project name",
    "forwards file filters",
    "does not build first"
  ]);

  if (packageJson.scripts?.["test:project"] !== "node scripts/run-vitest-project.mjs") {
    failures.push(
      "package.json test:project should run node scripts/run-vitest-project.mjs."
    );
  }
  expectContainsAll("scripts/run-vitest-project.mjs", testProjectScript, [
    "Usage: pnpm test:project -- <project> [vitest filters...]",
    "Known projects",
    "Use pnpm test when build output, generated artifacts, or package entrypoints matter.",
    '"pnpm"',
    '"exec"',
    '"vitest"',
    "--project"
  ]);
  await expectTestProjectHelperBehavior();

  for (const { packageDir, packageName, project } of expectedVitestProjects) {
    if (!vitestConfig.includes(`project("${project}"`)) {
      failures.push(`vitest.config.ts should define a ${project} project.`);
    }
    if (!testProjectScript.includes(`"${project}"`)) {
      failures.push(`scripts/run-vitest-project.mjs should list project ${project}.`);
    }
    if (!targetedTests.includes(`\`${project}\``)) {
      failures.push(
        `docs/development.md Targeted Test Loops should list Vitest project ${project}.`
      );
    }

    const manifestPath = resolve(repoRoot, packageDir, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (manifest.name !== packageName) {
      failures.push(`${packageDir}/package.json should be named ${packageName}.`);
    }
    if (!manifest.scripts?.test?.includes(`--project ${project}`)) {
      failures.push(
        `${packageDir}/package.json test script should run Vitest project ${project}.`
      );
    }
  }

  const integrationScript = packageJson.scripts?.["test:integration"];
  if (!integrationScript?.includes("--project integration")) {
    failures.push("package.json test:integration should run Vitest project integration.");
  }
  if (!vitestConfig.includes('project("integration"')) {
    failures.push("vitest.config.ts should define an integration project.");
  }
  if (!testProjectScript.includes('"integration"')) {
    failures.push("scripts/run-vitest-project.mjs should list project integration.");
  }
  if (!targetedTests.includes("`integration`")) {
    failures.push(
      "docs/development.md Targeted Test Loops should list Vitest project integration."
    );
  }

  expectContainsAll(
    "CONTRIBUTING.md targeted test guidance",
    contributing.replace(/\s+/g, " "),
    [
      "[targeted test loops](docs/development.md#targeted-test-loops)",
      "`pnpm --filter @metaharness/cli test`",
      "`pnpm test:project -- cli`",
      "without building first"
    ]
  );
}

async function expectTestProjectHelperBehavior() {
  let help;
  try {
    help = await execFile(process.execPath, [testProjectScriptPath, "--help"], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    failures.push(
      `scripts/run-vitest-project.mjs --help should exit 0: ${formatError(error)}.`
    );
    return;
  }

  const helpOutput = `${help.stdout}${help.stderr}`;
  expectContainsAll("scripts/run-vitest-project.mjs --help", helpOutput, [
    "Usage: pnpm test:project -- <project> [vitest filters...]",
    "Projects:",
    "Examples:",
    "pnpm test:project -- cli packages/cli/test/cli.test.ts",
    "Use pnpm test when build output, generated artifacts, or package entrypoints matter."
  ]);

  for (const { project } of expectedVitestProjects) {
    if (!helpOutput.includes(project)) {
      failures.push(`scripts/run-vitest-project.mjs --help should list ${project}.`);
    }
  }
  if (!helpOutput.includes("integration")) {
    failures.push("scripts/run-vitest-project.mjs --help should list integration.");
  }

  try {
    await execFile(process.execPath, [testProjectScriptPath, "not-a-project"], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024
    });
    failures.push("scripts/run-vitest-project.mjs should reject unknown projects.");
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    if (error.code !== 1) {
      failures.push(
        `scripts/run-vitest-project.mjs unknown-project exit code should be 1, got ${String(
          error.code
        )}.`
      );
    }
    expectContainsAll("scripts/run-vitest-project.mjs unknown project", output, [
      "Unknown Vitest project: not-a-project",
      "Known projects:",
      "core",
      "integration"
    ]);
  }
}

function expectProviderSetupGuidance() {
  expectContainsAll("README.md Provider Setup", readme, [
    "For SDK usage, install",
    "`@metaharness/core`, the adapter packages you use",
    "`@metaharness/cli` includes the metaharness adapters",
    "For mock-only CLI usage, omit provider SDKs."
  ]);

  expectContainsAll("docs/troubleshooting.md Provider Setup", troubleshooting, [
    "For SDK usage, install",
    "For CLI or generated GitHub workflow usage, install `@metaharness/cli`",
    "includes the metaharness adapter packages",
    "For mock-only CLI usage, omit provider SDKs."
  ]);
}

function expectPolicyEnvTemplateGuidance() {
  expectContainsAll("docs/policy.md env template guidance", policy.replace(/\s+/g, " "), [
    ".env.local",
    ".env.*.local",
    ".env.production",
    "[.env.example](../.env.example)",
    "placeholder",
    "project-specific secret file names",
    "filesystem.deny"
  ]);
}

async function expectLiveProviderGuidance() {
  for (const [label, source] of [
    ["README.md live provider guidance", readme],
    ["CONTRIBUTING.md live provider guidance", contributing],
    ["docs/development.md live provider guidance", development],
    ["docs/conformance.md live provider guidance", conformance]
  ]) {
    const normalized = source.replace(/\s+/g, " ");
    expectContainsAll(label, normalized, [
      "`pnpm test:live`",
      "no live provider gate",
      "exactly `1`",
      "ignored",
      "`pnpm test:live -- --help`",
      "`pnpm test:integration`",
      ".env.example",
      "placeholder-only",
      "repo does not auto-load",
      "blank"
    ]);
  }

  for (const [label, source] of [
    ["README.md live provider all-gates command", readme],
    ["CONTRIBUTING.md live provider all-gates command", contributing],
    ["docs/development.md live provider all-gates command", development]
  ]) {
    const normalized = source.replace(/\s+/g, " ");
    expectContainsAll(label, normalized, [
      "ANTHROPIC_API_KEY=",
      "CURSOR_API_KEY=",
      "OPENAI_API_KEY=",
      "metaharness_TEST_CLAUDE=1",
      "metaharness_TEST_CURSOR=1",
      "metaharness_TEST_CODEX=1",
      "metaharness_TEST_CODEX_APPSERVER=1",
      "pnpm test:live"
    ]);
  }

  const { stdout } = await execFile("node", [
    resolve(repoRoot, "scripts/run-live-tests.mjs"),
    "--help"
  ]);
  expectContainsAll("scripts/run-live-tests.mjs --help", stdout, [
    "Usage: pnpm test:live -- [vitest filters...]",
    "Gate values must be exactly 1.",
    "Provider gates:",
    "ANTHROPIC_API_KEY=... metaharness_TEST_CLAUDE=1",
    "CURSOR_API_KEY=... metaharness_TEST_CURSOR=1",
    "OPENAI_API_KEY=... metaharness_TEST_CODEX=1",
    "OPENAI_API_KEY=... metaharness_TEST_CODEX_APPSERVER=1",
    "Use pnpm test:integration for mock-only integration conformance."
  ]);

  expectContainsAll(".env.example live provider template", envExample, [
    "repo does not auto-load this file",
    "ANTHROPIC_API_KEY=",
    "CURSOR_API_KEY=",
    "OPENAI_API_KEY=",
    "metaharness_TEST_CLAUDE=",
    "metaharness_TEST_CURSOR=",
    "metaharness_TEST_CODEX=",
    "metaharness_TEST_CODEX_APPSERVER=",
    "must be exactly 1 when enabled",
    "Keep these blank",
    "normal credential-free"
  ]);
}

function expectConsumerSmokeGuidance() {
  const normalized = development.replace(/\s+/g, " ");
  expectContainsAll("docs/development.md consumer smoke guidance", normalized, [
    "`pnpm consumer:smoke` packs every publishable package",
    "temporary downstream projects",
    "first-run artifact workflow",
    "`hk runs`",
    "`hk stream latest`",
    "`hk ledger show latest`",
    "CLI-only install",
    "`@metaharness/cli` without direct core or adapter dependencies"
  ]);
}

function expectGeneratedArtifactGuidance() {
  const generatedArtifacts = markdownSection(development, "Generated Artifacts");
  if (!generatedArtifacts) {
    failures.push(
      'docs/development.md should include a "## Generated Artifacts" section.'
    );
    return;
  }

  expectContainsAll(
    "docs/development.md generated artifact guidance",
    generatedArtifacts,
    [
      "Source of truth",
      "Focused refresh command",
      "`pnpm generated:write`",
      "`pnpm generated:check`"
    ]
  );

  const rows = tableRows(generatedArtifacts);
  for (const expectedRow of expectedGeneratedArtifactRows) {
    const row = rows.find((cells) => cells.join(" ").includes(expectedRow.artifact));
    if (!row) {
      failures.push(
        `docs/development.md Generated Artifacts should include ${expectedRow.artifact}.`
      );
      continue;
    }

    const rowText = row.join(" ");
    if (!rowText.includes(expectedRow.source)) {
      failures.push(
        `docs/development.md Generated Artifacts row for ${expectedRow.artifact} should include ${expectedRow.source}.`
      );
    }
    if (!rowText.includes(expectedRow.command)) {
      failures.push(
        `docs/development.md Generated Artifacts row for ${expectedRow.artifact} should include ${expectedRow.command}.`
      );
    }
    if (expectedRow.command.startsWith("pnpm ")) {
      expectPnpmCommandScriptExists(expectedRow.command);
    }
  }
}

async function expectArtifactCleanupGuidance() {
  expectPnpmCommandScriptExists("pnpm artifacts:clean -- --dry-run");
  const normalizedDevelopment = development.replace(/\s+/g, " ");
  const normalizedReadme = readme.replace(/\s+/g, " ");
  const normalizedTroubleshooting = troubleshooting.replace(/\s+/g, " ");

  expectContainsAll("README.md artifact cleanup guidance", normalizedReadme, [
    "pnpm artifacts:clean -- --dry-run",
    "pnpm artifacts:clean -- --yes",
    "ignored local `.harness` artifacts"
  ]);
  expectContainsAll(
    "docs/development.md artifact cleanup guidance",
    normalizedDevelopment,
    [
      "pnpm artifacts:clean -- --dry-run",
      "does not delete by default",
      "pnpm artifacts:clean -- --yes"
    ]
  );
  expectContainsAll(
    "docs/troubleshooting.md artifact cleanup guidance",
    normalizedTroubleshooting,
    [
      "Local `.harness` artifacts accumulate",
      "pnpm artifacts:clean -- --dry-run",
      "pnpm artifacts:clean -- --yes"
    ]
  );

  const { stdout: helpOutput } = await execFile("node", [
    resolve(repoRoot, "scripts/clean-artifacts.mjs"),
    "--help"
  ]);
  expectContainsAll("scripts/clean-artifacts.mjs --help", helpOutput, [
    "Usage: pnpm artifacts:clean -- [--dry-run|--yes]",
    "Dry-run is the default; deletion requires --yes.",
    "Local .harness artifacts can contain prompts, transcripts, diffs, command summaries, and provider metadata.",
    ".harness/runs",
    ".harness/compares",
    ".harness/worktrees",
    ".harness/handoff-worktrees",
    "pnpm artifacts:clean -- --dry-run",
    "pnpm artifacts:clean -- --yes"
  ]);

  const { stdout: dryRunOutput } = await execFile("node", [
    resolve(repoRoot, "scripts/clean-artifacts.mjs"),
    "--dry-run"
  ]);
  expectContainsAll("scripts/clean-artifacts.mjs --dry-run", dryRunOutput, [
    "metaharness artifact cleanup dry run",
    "Local .harness artifacts can contain prompts, transcripts, diffs, command summaries, and provider metadata.",
    "Run pnpm artifacts:clean -- --yes to delete existing targets.",
    ".harness/runs",
    ".harness/compares"
  ]);
}

async function expectWorkspaceCleanupGuidance() {
  expectPnpmCommandScriptExists("pnpm clean -- --dry-run");
  const normalizedDevelopment = development.replace(/\s+/g, " ");
  const normalizedReadme = readme.replace(/\s+/g, " ");
  const normalizedTroubleshooting = troubleshooting.replace(/\s+/g, " ");

  expectContainsAll("README.md workspace cleanup guidance", normalizedReadme, [
    "All ignored local outputs",
    "pnpm clean -- --dry-run",
    "pnpm clean -- --yes",
    "package `dist/`, coverage, `.tsbuildinfo`, and `.harness` artifacts"
  ]);
  expectContainsAll(
    "docs/development.md workspace cleanup guidance",
    normalizedDevelopment,
    [
      "pnpm clean -- --dry-run",
      "package `dist/` directories",
      "coverage directories",
      ".tsbuildinfo",
      "local `.harness` artifacts",
      "does not delete by default",
      "pnpm clean -- --yes"
    ]
  );
  expectContainsAll(
    "docs/troubleshooting.md workspace cleanup guidance",
    normalizedTroubleshooting,
    ["Ignored local outputs accumulate", "pnpm clean -- --dry-run", "pnpm clean -- --yes"]
  );

  const { stdout: helpOutput } = await execFile("node", [
    resolve(repoRoot, "scripts/clean-workspace.mjs"),
    "--help"
  ]);
  expectContainsAll("scripts/clean-workspace.mjs --help", helpOutput, [
    "Usage: pnpm clean -- [--dry-run|--yes]",
    "Dry-run is the default; deletion requires --yes.",
    "Local .harness artifacts can contain prompts, transcripts, diffs, command summaries, and provider metadata.",
    "package dist directories",
    "coverage directories",
    "*.tsbuildinfo files",
    ".harness run, compare, worktree, handoff, and task artifacts",
    "pnpm clean -- --dry-run",
    "pnpm clean -- --yes"
  ]);

  const { stdout: dryRunOutput } = await execFile("node", [
    resolve(repoRoot, "scripts/clean-workspace.mjs"),
    "--dry-run"
  ]);
  expectContainsAll("scripts/clean-workspace.mjs --dry-run", dryRunOutput, [
    "metaharness workspace cleanup dry run",
    "Local .harness artifacts can contain prompts, transcripts, diffs, command summaries, and provider metadata.",
    "Run pnpm clean -- --yes to delete existing targets.",
    "packages/core/dist",
    ".harness/runs"
  ]);
}

function expectDoctorGuidance() {
  if (
    packageJson.scripts?.["setup:doctor"] !==
    "pnpm setup:check && pnpm build && pnpm hk doctor --provider mock"
  ) {
    failures.push(
      "package.json setup:doctor script should run setup:check, build, and mock hk doctor."
    );
  }

  const normalizedContributing = contributing.replace(/\s+/g, " ");
  const normalizedDevelopment = development.replace(/\s+/g, " ");

  expectContainsAll("CONTRIBUTING.md setup guidance", normalizedContributing, [
    "pnpm setup:doctor",
    "one-command fresh-clone health check",
    "credential-free mock CLI doctor"
  ]);

  expectContainsAll("docs/development.md fresh clone guidance", normalizedDevelopment, [
    "pnpm setup:doctor",
    "first-hour setup health check",
    "runs `pnpm setup:check`",
    "builds all packages",
    "runs `pnpm hk doctor --provider mock`",
    'pnpm hk run --provider mock --task "Smoke test"',
    "pnpm hk runs",
    "pnpm hk stream latest",
    "pnpm hk ledger show latest"
  ]);

  expectContainsAll(
    "docs/troubleshooting.md doctor command decision guidance",
    troubleshooting.replace(/\s+/g, " "),
    [
      "Start with the health check that matches where you are",
      "Fresh clone, missing build output, or setup drift",
      "`pnpm setup:doctor`",
      "Existing built CLI and one provider to inspect",
      "`pnpm hk doctor --provider <provider>`",
      "Automation or issue report that needs parseable data",
      "`pnpm --silent hk doctor --provider <provider> --json`",
      "runs setup checks, builds packages, then runs the credential-free mock CLI doctor",
      "Use `hk doctor` after the CLI is built",
      "`TELEMETRY_EXPORTER_UNSUPPORTED` appears",
      "`METAHARNESS_OTEL_EXPORTER`",
      "`metaharness_OTEL_EXPORTER`",
      "the `metaharness_OTEL_*` alias wins"
    ]
  );
}

function expectFirstHourOnboardingGuidance() {
  const quickstart = markdownSection(readme, "Quickstart");
  if (!quickstart) {
    failures.push('README.md should include a "## Quickstart" section.');
  } else {
    expectContainsAll("README.md Quickstart", quickstart, [
      "corepack enable",
      "pnpm install",
      "pnpm setup:doctor",
      "pnpm hk run",
      "pnpm hk runs",
      "pnpm hk stream latest",
      "pnpm hk ledger show latest"
    ]);
    if (quickstart.includes("pnpm build\npnpm hk doctor --provider mock")) {
      failures.push(
        "README.md Quickstart should use pnpm setup:doctor instead of a manual build plus hk doctor sequence."
      );
    }
  }

  const freshWorkspaceInit = markdownSection(readme, "Fresh Workspace Init");
  if (!freshWorkspaceInit) {
    failures.push('README.md should include a "## Fresh Workspace Init" section.');
  } else {
    const normalizedFreshWorkspaceInit = freshWorkspaceInit.replace(/\s+/g, " ");
    expectContainsAll("README.md Fresh Workspace Init", normalizedFreshWorkspaceInit, [
      'pnpm hk --cwd "$WORKDIR" init --providers codex,cursor,claude',
      'pnpm hk --cwd "$WORKDIR" doctor --provider codex',
      'pnpm hk --cwd "$WORKDIR" run --provider codex --task "Summarize this workspace"',
      'pnpm hk --cwd "$WORKDIR" ledger show latest',
      'Keep the same `--cwd "$WORKDIR"`',
      "`latest` resolve inside that workspace",
      "`pnpm exec hk`",
      "inside this repository after `pnpm build`, `pnpm hk` runs the built CLI"
    ]);
  }

  const firstHourPath = markdownSection(docsReadme, "First Hour Path");
  if (!firstHourPath) {
    failures.push('docs/README.md should include a "## First Hour Path" section.');
  } else {
    expectContainsAll("docs/README.md First Hour Path", firstHourPath, [
      "corepack enable",
      "pnpm install",
      "pnpm setup:doctor",
      "pnpm commands",
      "pnpm --silent commands -- --json",
      "[Glossary](glossary.md)",
      "adapter, ledger, handoff",
      "portable event, or raw provider event",
      "[examples/quickstart](../examples/quickstart)",
      "pnpm hk runs",
      "pnpm hk stream latest",
      "pnpm hk ledger show latest",
      "[After A CLI Example](../examples/#after-a-cli-example)",
      "[Development change map](development.md#change-map)"
    ]);
    if (firstHourPath.includes("pnpm hk doctor --provider mock")) {
      failures.push(
        "docs/README.md First Hour Path should point fresh clones at pnpm setup:doctor."
      );
    }
  }

  expectContainsAll("examples/quickstart README", examplesQuickstart, [
    "pnpm install",
    "pnpm setup:doctor",
    "pnpm hk run --provider mock",
    "pnpm hk runs",
    "pnpm hk stream latest",
    "pnpm hk ledger show latest"
  ]);
  if (examplesQuickstart.includes("pnpm build\npnpm hk doctor --provider mock")) {
    failures.push(
      "examples/quickstart/README.md should use pnpm setup:doctor instead of a manual build plus hk doctor sequence."
    );
  }
}

function expectContainsAll(label, source, snippets) {
  for (const snippet of snippets) {
    if (!source.includes(snippet)) {
      failures.push(`${label} should include ${JSON.stringify(snippet)}.`);
    }
  }
}

function expectPnpmCommandScriptExists(command) {
  if (command.startsWith("pnpm --filter ") || command.startsWith("pnpm exec ")) {
    return;
  }
  const scriptName = command.match(/^pnpm\s+(\S+)/)?.[1];
  if (scriptName && packageJson.scripts?.[scriptName]) {
    return;
  }
  failures.push(`package.json should define a script for ${JSON.stringify(command)}.`);
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

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
