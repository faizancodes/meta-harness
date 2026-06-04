import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

const [
  packageJsonText,
  changesetConfigText,
  ciWorkflow,
  releaseWorkflow,
  generatedArtifactCheck,
  liveTestRunner
] = await Promise.all([
  readFile(resolve(repoRoot, "package.json"), "utf8"),
  readFile(resolve(repoRoot, ".changeset/config.json"), "utf8"),
  readFile(resolve(repoRoot, ".github/workflows/ci.yml"), "utf8"),
  readFile(resolve(repoRoot, ".github/workflows/release.yml"), "utf8"),
  readFile(resolve(repoRoot, "scripts/check-generated-artifacts.mjs"), "utf8"),
  readFile(resolve(repoRoot, "scripts/run-live-tests.mjs"), "utf8")
]);

const packageJson = JSON.parse(packageJsonText);
const changesetConfig = JSON.parse(changesetConfigText);
const scripts = packageJson.scripts ?? {};
const failures = [];

expectScript(
  "version:packages",
  "changeset version",
  "Changesets Action needs a stable version command."
);
expectScript(
  "release:publish",
  "changeset publish",
  "Release publishing must call Changesets publish."
);
expectScript(
  "package:check",
  "scripts/check-package-packing.mjs",
  "Release validation should prove publishable tarball contents."
);
expectScript(
  "check",
  "pnpm package:check",
  "The default validation command should include package tarball checks."
);
expectScript(
  "setup:check",
  "scripts/check-repo-setup.mjs",
  "Repository setup defaults should have a fast drift check."
);
expectScript(
  "cli:help:check",
  "scripts/check-cli-help.mjs",
  "Built CLI help should have a discoverability smoke check."
);
expectScript(
  "docs:cli:check",
  "scripts/check-cli-docs.mjs",
  "CLI reference docs should have a command-surface drift check."
);
expectScript(
  "docs:check",
  "pnpm docs:cli:check",
  "The docs aggregate should include CLI reference docs checks."
);
expectScript(
  "docs:check",
  "pnpm docs:validation:check",
  "The docs aggregate should include validation-guidance docs checks."
);
expectScript(
  "docs:check",
  "pnpm docs:links:check",
  "The docs aggregate should include Markdown local-link checks."
);
expectScript(
  "docs:check",
  "pnpm docs:sources:check",
  "The docs aggregate should include verified source docs checks."
);
expectScript(
  "docs:check",
  "pnpm docs:error-codes:check",
  "The docs aggregate should include source-derived error code docs checks."
);
expectScript(
  "docs:check",
  "pnpm docs:policy:check",
  "The docs aggregate should include policy documentation checks."
);
expectScript(
  "docs:check",
  "pnpm docs:snippets:check",
  "The docs aggregate should include public documentation snippet checks."
);
expectScript(
  "docs:check",
  "pnpm examples:docs:check",
  "The docs aggregate should include example documentation checks."
);
expectScript(
  "docs:validation:check",
  "scripts/check-validation-guidance.mjs",
  "Validation troubleshooting guidance should have a drift check."
);
expectScript(
  "docs:links:check",
  "scripts/check-markdown-links.mjs",
  "Markdown navigation should have a local-link drift check."
);
expectScript(
  "docs:sources:check",
  "scripts/check-verified-sources.mjs",
  "Verified source docs should have a required-source coverage check."
);
expectScript(
  "docs:error-codes:check",
  "scripts/check-error-codes-doc.mjs",
  "Public error code documentation should have a source-derived drift check."
);
expectScript(
  "docs:policy:check",
  "scripts/check-policy-docs.mjs",
  "Public policy documentation examples should have a validation drift check."
);
expectScript(
  "docs:snippets:check",
  "scripts/check-doc-snippets.mjs",
  "Public TypeScript documentation examples should have a drift check."
);
expectScript(
  "docs:capabilities",
  "scripts/generate-provider-capabilities.mjs",
  "Generated capability docs should render and write through Node instead of a shell pipeline."
);
expectScript(
  "generated:write",
  "scripts/generate-provider-capabilities.mjs",
  "Generated artifact recovery should refresh capability docs."
);
expectScript(
  "generated:write",
  "scripts/generate-schemas.mjs",
  "Generated artifact recovery should refresh JSON Schemas."
);
expectScript(
  "examples:docs:check",
  "scripts/check-examples-docs.mjs",
  "Example directories should have a discoverability drift check."
);
expectScript(
  "consumer:smoke",
  "scripts/smoke-consumer-install.mjs",
  "Packed packages should be exercised from a downstream consumer project."
);
expectScript(
  "test:live",
  "scripts/run-live-tests.mjs",
  "Live provider conformance should fail fast when no live gate is enabled."
);
expectScript(
  "check",
  "pnpm setup:check",
  "The default validation command should include repository setup checks."
);
expectScript(
  "check",
  "pnpm cli:help:check",
  "The default validation command should include built CLI help checks."
);
expectScript(
  "check",
  "pnpm docs:check",
  "The default validation command should include the full documentation aggregate."
);
expectScript(
  "ci:check",
  "pnpm check",
  "CI-equivalent validation should start with the default local check."
);

for (const requiredCommand of [
  "pnpm check",
  "pnpm generated:check",
  "pnpm examples:smoke",
  "pnpm consumer:smoke"
]) {
  if (!scripts["ci:check"]?.includes(requiredCommand)) {
    failures.push(`ci:check should run ${requiredCommand}.`);
  }
}

expectScript(
  "release:publish",
  "pnpm ci:check",
  "Release publishing should use the same credential-free gate as CI."
);

expectChangesetConfig(
  "$schema",
  "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "Changesets config should keep a documented schema for editor validation."
);
expectChangesetConfig(
  "access",
  "public",
  "Packages are intended for public npm publishing."
);
expectChangesetConfig(
  "baseBranch",
  "main",
  "Changesets should compare release intent against the protected main branch."
);
expectChangesetConfig(
  "changelog",
  "@changesets/cli/changelog",
  "Changesets should generate package changelog entries."
);
expectChangesetConfig(
  "commit",
  false,
  "Changesets Action should manage version PR commits instead of local changeset commands."
);
expectChangesetConfig(
  "privatePackages.version",
  true,
  "The private root workspace should stay versionable for Changesets bookkeeping."
);
expectChangesetConfig(
  "privatePackages.tag",
  false,
  "The private root workspace should not receive published tags."
);
expectChangesetConfig(
  "updateInternalDependencies",
  "patch",
  "Internal workspace dependency ranges should update on patch releases."
);

expectWorkflow("on:", "Release workflow must declare triggers.");
expectWorkflow("push:", "Release workflow should run after merges to main.");
expectWorkflow(
  "branches:",
  "Release workflow should scope its push trigger to protected branches."
);
expectWorkflow("main", "Release workflow should publish from main.");
expectWorkflow(
  "contents: write",
  "Changesets Action needs content write permission for version commits and tags."
);
expectWorkflow(
  "pull-requests: write",
  "Changesets Action needs pull-request write permission for version PRs."
);
expectWorkflow("concurrency:", "Release workflow should serialize release runs.");
expectWorkflow(
  "registry-url: https://registry.npmjs.org",
  "Release workflow should publish against the npm registry."
);
expectWorkflow("changesets/action@v1", "Release workflow should use Changesets Action.");
expectWorkflow(
  "version: pnpm version:packages",
  "Changesets Action should use the documented version script."
);
expectWorkflow(
  "publish: pnpm release:publish",
  "Changesets Action should use the guarded publish script."
);
expectWorkflow(
  "github-token: ${{ secrets.GITHUB_TOKEN }}",
  "Release workflow should pass the GitHub token explicitly."
);
expectWorkflow(
  "NPM_TOKEN: ${{ secrets.NPM_TOKEN }}",
  "Release workflow should pass NPM_TOKEN for Changesets publish."
);
expectWorkflow(
  "NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}",
  "Release workflow should pass NODE_AUTH_TOKEN for npm registry auth."
);
expectCiWorkflow(
  "pnpm ci:check",
  "CI should run the documented CI-equivalent validation command."
);

if (scripts["docs:capabilities"]?.includes("|")) {
  failures.push("scripts.docs:capabilities should not use a shell pipeline.");
}

if (scripts["generated:write"]?.includes("|")) {
  failures.push("scripts.generated:write should not use a shell pipeline.");
}

if (!generatedArtifactCheck.includes("pnpm generated:write")) {
  failures.push(
    "scripts/check-generated-artifacts.mjs should point stale artifact recovery at pnpm generated:write."
  );
}
for (const expectedText of [
  "unreadable",
  "Generated artifacts are out of date or missing:",
  "error instanceof Error ? error.message : String(error)"
]) {
  if (!generatedArtifactCheck.includes(expectedText)) {
    failures.push(
      `scripts/check-generated-artifacts.mjs should report missing or unreadable generated artifacts without a raw stack trace; missing ${JSON.stringify(
        expectedText
      )}.`
    );
  }
}

for (const liveGate of [
  "metaharness_TEST_CLAUDE",
  "metaharness_TEST_CURSOR",
  "metaharness_TEST_CODEX",
  "metaharness_TEST_CODEX_APPSERVER"
]) {
  if (!liveTestRunner.includes(liveGate)) {
    failures.push(`scripts/run-live-tests.mjs should document and check ${liveGate}.`);
  }
}

if (!liveTestRunner.includes("pnpm test:integration")) {
  failures.push(
    "scripts/run-live-tests.mjs should point mock-only conformance at pnpm test:integration."
  );
}

if (
  !liveTestRunner.includes("invalidGateValues") ||
  !liveTestRunner.includes("set gate values to exactly 1")
) {
  failures.push(
    "scripts/run-live-tests.mjs should explain live provider gates must be set to exactly 1."
  );
}

if (
  !liveTestRunner.includes("normalizeVitestArgs(process.argv.slice(2))") ||
  !liveTestRunner.includes('args[0] === "--"')
) {
  failures.push(
    "scripts/run-live-tests.mjs should strip pnpm's leading -- separator before forwarding Vitest args."
  );
}

if (failures.length > 0) {
  throw new Error(`Release workflow check failed:\n- ${failures.join("\n- ")}`);
}

console.log("Release workflow, Changesets config, and publish scripts are aligned.");

function expectScript(name, expectedText, message) {
  const script = scripts[name];
  if (typeof script !== "string") {
    failures.push(`package.json is missing scripts.${name}. ${message}`);
    return;
  }

  if (!script.includes(expectedText)) {
    failures.push(
      `scripts.${name} should include ${JSON.stringify(expectedText)}. ${message}`
    );
  }
}

function expectWorkflow(expectedText, message) {
  if (!releaseWorkflow.includes(expectedText)) {
    failures.push(
      `.github/workflows/release.yml should include ${JSON.stringify(
        expectedText
      )}. ${message}`
    );
  }
}

function expectCiWorkflow(expectedText, message) {
  if (!ciWorkflow.includes(expectedText)) {
    failures.push(
      `.github/workflows/ci.yml should include ${JSON.stringify(expectedText)}. ${message}`
    );
  }
}

function expectChangesetConfig(path, expected, message) {
  const actual = path
    .split(".")
    .reduce(
      (value, key) => (value && typeof value === "object" ? value[key] : undefined),
      changesetConfig
    );

  if (actual !== expected) {
    failures.push(
      `.changeset/config.json ${path} should be ${JSON.stringify(
        expected
      )}, got ${JSON.stringify(actual)}. ${message}`
    );
  }
}
