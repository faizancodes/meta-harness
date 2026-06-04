# Development

Use this guide when working inside the metaharness repository.

## Prerequisites

- Node 22+
- pnpm 9.13+
- Git for diff capture, compare worktrees, and provider edit workflows

The repo includes `.nvmrc`, `.node-version`, `.editorconfig`, `packageManager`,
root `engines`, and `pnpm-workspace.yaml` settings so local shells, editors,
Corepack, pnpm, and CI all point at the same toolchain and whitespace defaults.
Run `corepack enable` before the first install if pnpm is not already available
locally. `pnpm setup:check` validates the active Node and pnpm versions, these
repo-level setup files, editor defaults, the env template, and ignore hygiene
without installing dependencies.

AI coding agents should read the root [`AGENTS.md`](../AGENTS.md) before
editing. It summarizes provider capability rules, Context7 documentation usage,
repo-local CLI build expectations, sensitive artifact handling, and validation
gates for automated sessions.

Provider API keys are only needed for live provider conformance. Mock tests and
most package tests do not require external credentials.

The root workspace intentionally keeps real provider SDKs in `devDependencies`
for conformance. With `auto-install-peers=false`, the root also lists the Claude
Agent SDK's required companion peers so `pnpm install` stays clean for new
contributors. `.npmrc` also enables engine and package-manager checks so
contributors get setup failures early instead of later TypeScript or runtime
errors. Adapter packages still expose provider SDKs as optional peers for
consumers.

## Package Map

| Package                      | Purpose                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@metaharness/core`          | Harness API, portable events, run store, workspace/git capture, ledgers, handoff, compare, doctor, errors |
| `@metaharness/policy`        | Policy parsing, validation, provider-native hint compilation, command checks                              |
| `@metaharness/telemetry`     | Optional OpenTelemetry setup around core spans                                                            |
| `@metaharness/adapter-mock`  | Deterministic in-process adapter for tests, docs, and CI                                                  |
| `@metaharness/claude`        | Claude Agent SDK adapter                                                                                  |
| `@metaharness/cursor`        | Cursor SDK adapter for local/cloud behavior where supported                                               |
| `@metaharness/codex`         | Codex SDK adapter plus app-server mode                                                                    |
| `@metaharness/cli`           | `hk` CLI commands                                                                                         |
| `@metaharness/github-action` | GitHub Action wrapper around the same harness API                                                         |

## Change Map

Use this table to find the right edit surface, nearby tests, public docs, and
focused validation before running the broader gate:

| Change area                                       | Start in                                                                                                                                              | Nearby tests or guards                                                                                             | Public docs to keep in sync                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Harness lifecycle, events, storage, and ledgers   | `packages/core/src/create-harness.ts`, `packages/core/src/event-recorder.ts`, `packages/core/src/run-store.ts`, `packages/core/src/session-ledger.ts` | `packages/core/test/*`, `tests/integration/conformance.test.ts`, `pnpm test`                                       | `docs/sdk.md`, `docs/event-model.md`, `docs/ledger.md`, `docs/handoff.md` |
| Config fields, config validation, and schemas     | `packages/core/src/config-validation.ts`, `packages/core/src/json-schemas.ts`, `packages/cli/src/load-config.ts`                                      | `packages/core/test/config-validation.test.ts`, `packages/core/test/json-schemas.test.ts`, `pnpm generated:check`  | `docs/configuration.md`, `schemas/`                                       |
| CLI commands, help, and artifact commands         | `packages/cli/src/main.ts`, `packages/cli/src/commands/`, `packages/cli/src/run-artifacts.ts`                                                         | `packages/cli/test/cli.test.ts`, `pnpm cli:help:check`, `pnpm docs:cli:check`                                      | `docs/cli.md`, `packages/cli/README.md`, `docs/troubleshooting.md`        |
| Provider adapter capabilities, config, and events | `packages/*/src/*-adapter.ts`, `packages/*/src/map-config.ts`, `packages/*/src/map-events.ts`, `packages/core/src/types/capabilities.ts`              | adapter package tests, `tests/integration/conformance.test.ts`, `pnpm generated:check`                             | `docs/adapters.md`, `docs/provider-capabilities.md`, package README       |
| Policy parsing, command checks, and redaction     | `packages/policy/src/`, `packages/core/src/redact.ts`, `packages/core/src/verification.ts`                                                            | `packages/policy/test/policy.test.ts`, `packages/core/test/command-policy-guard.test.ts`, `pnpm docs:policy:check` | `docs/policy.md`, `docs/security.md`, `metaharness.policy.yaml`           |
| GitHub Action workflow behavior                   | `packages/github-action/src/index.ts`, `packages/github-action/action.yml`                                                                            | `packages/github-action/test/github-action.test.ts`, `pnpm package:check`, `pnpm release:check`                    | `docs/github-action.md`, `packages/github-action/README.md`               |
| Public examples and onboarding paths              | `examples/`, `README.md`, `CONTRIBUTING.md`                                                                                                           | `pnpm docs:check`, `pnpm examples:smoke`, `pnpm consumer:smoke`                                                    | `examples/README.md`, example READMEs, package READMEs                    |
| Package manifests, packing, and release metadata  | package `package.json` files, `package.json`, `.changeset/config.json`, `.github/workflows/release.yml`, `scripts/check-package-packing.mjs`          | `packages/core/test/package-manifests.test.ts`, `pnpm package:check`, `pnpm consumer:smoke`, `pnpm release:check`  | package READMEs, `README.md`, `docs/development.md`                       |
| Diagnostics, typed errors, and recovery guidance  | `packages/*/src`, `docs/error-codes.md`, `docs/troubleshooting.md`                                                                                    | `pnpm docs:error-codes:check`, `pnpm docs:links:check`, `pnpm docs:validation:check`                               | `docs/error-codes.md`, `docs/troubleshooting.md`, `docs/cli.md`           |

If a change touches multiple rows, run the focused checks for every touched row,
then finish with `pnpm check` or `pnpm ci:check` for broad handoff-ready work.

## Package Manifests

Every package intended for publication should include a human-readable
`description`, searchable `keywords`, package `README.md`, `types`, root
`exports`, `files`, `engines`, and `publishConfig.access = public`. The SDK,
adapter, policy, telemetry, and CLI packages declare Node `>=22.0.0`. The
GitHub Action package declares Node `>=20.0.0` because JavaScript actions
currently run on the `node20` action runtime.

Package READMEs should start with the package name, include install guidance,
and end with practical notes. TypeScript snippets in package READMEs are
typechecked by `pnpm docs:snippets:check`, policy examples are validated by
`pnpm docs:policy:check`, and publishable tarballs must include
the README.

Provider SDKs must remain optional peers, not direct dependencies. The manifest
tests verify that `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`, and
`@openai/codex-sdk` stay out of package `dependencies` and are marked optional
when listed in `peerDependencies`.

## Fresh Clone Checklist

```bash
corepack enable
pnpm install
pnpm setup:doctor
pnpm hk --help
pnpm hk run --provider mock --task "Smoke test"
pnpm hk runs
pnpm hk stream latest
pnpm hk ledger show latest
```

The mock run should create `.harness/runs/<run-id>/` with `events.ndjson`,
`result.json`, `ledger.json`, `handoff.md`, `diff.patch`, and
`verification.log`.
Use the printed run id for older runs, or `latest` for the most recent run under
the active workspace and `storage.rootDir`.

`pnpm hk init` refuses to overwrite existing generated files. Use
`pnpm hk init --force` only when regenerating config, policy, and harness ignore
files is intentional.

## Root Scripts

| Command                             | Use                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm artifacts:clean -- --dry-run` | Inspect ignored local `.harness` artifacts before intentionally deleting them                 |
| `pnpm check`                        | Full local validation: setup, lint, typecheck, tests, packaging, and format                   |
| `pnpm ci:check`                     | CI-equivalent validation including generated artifacts, examples, and consumer install smoke  |
| `pnpm clean -- --dry-run`           | Inspect ignored local build, coverage, TypeScript, and `.harness` outputs before deleting     |
| `pnpm commands`                     | Print the short terminal command guide for repo contributors                                  |
| `pnpm setup:check`                  | Verify active Node/pnpm versions, editor defaults, agent guidance, workspace, CI, and ignores |
| `pnpm setup:doctor`                 | Build packages and run the credential-free mock CLI doctor                                    |
| `pnpm lint`                         | ESLint over the repo                                                                          |
| `pnpm typecheck`                    | TypeScript checks for all packages                                                            |
| `pnpm typecheck:examples`           | Strict TypeScript check for SDK examples                                                      |
| `pnpm test`                         | Build packages, then run all Vitest projects and mock conformance                             |
| `pnpm test:project -- cli`          | Run one Vitest project without building first                                                 |
| `pnpm test:integration`             | Integration conformance project only                                                          |
| `pnpm test:live`                    | Require a live provider gate, then run real-provider integration conformance                  |
| `pnpm build`                        | Build all packages                                                                            |
| `pnpm cli:help:check`               | Build the CLI, then smoke-test root and nested `hk --help` output                             |
| `pnpm docs:check`                   | Run all documentation and example-documentation drift checks                                  |
| `pnpm docs:cli:check`               | Verify CLI docs cover current options and `pnpm --silent` JSON examples                       |
| `pnpm docs:validation:check`        | Verify validation guidance, command lists, and command expansions                             |
| `pnpm docs:links:check`             | Verify local Markdown links, docs indexes, root README docs map, and package maps             |
| `pnpm docs:sources:check`           | Verify source-verification docs cover required provider, protocol, and tooling sources        |
| `pnpm docs:error-codes:check`       | Verify `docs/error-codes.md` lists current source-derived public codes                        |
| `pnpm docs:policy:check`            | Validate public metaharness policy YAML examples and `parsePolicyYaml()` literals             |
| `pnpm docs:snippets:check`          | Typecheck public TypeScript snippets and enforce capability-driven examples                   |
| `pnpm examples:docs:check`          | Verify every example directory has indexed README guidance and repo-root commands             |
| `pnpm package:check`                | Build packages, pack publishable tarballs, and inspect packed contents                        |
| `pnpm consumer:smoke`               | Install packed packages into a temp consumer project and run SDK/CLI smoke                    |
| `pnpm example:sdk`                  | Build packages, then run the credential-free SDK mock example                                 |
| `pnpm examples:smoke`               | Build packages, then smoke-test credential-free CLI and SDK example paths                     |
| `pnpm generated:check`              | Build packages, then verify generated docs and schemas are in sync                            |
| `pnpm generated:write`              | Build packages, then regenerate all committed generated docs and schemas                      |
| `pnpm format`                       | Prettier check; append paths to limit scope                                                   |
| `pnpm format:write`                 | Apply Prettier formatting; append paths to limit scope                                        |
| `pnpm docs:capabilities`            | Build packages, then regenerate `docs/provider-capabilities.md`                               |
| `pnpm schemas:generate`             | Build packages, then regenerate committed JSON Schema artifacts                               |
| `pnpm changeset`                    | Create a Changesets release-intent file for public package changes                            |
| `pnpm version:packages`             | Apply pending Changesets to package versions and changelogs                                   |
| `pnpm release:check`                | Verify release scripts, Changesets config, and workflow wiring                                |
| `pnpm release:publish`              | Validate the repo, then publish versioned packages with Changesets                            |
| `pnpm hk --help`                    | Show CLI help from the built CLI                                                              |
| `pnpm hk doctor --provider mock`    | Run the built CLI's credential-free setup doctor                                              |

`pnpm hk ...` is the most explicit way to run the CLI from the repo. It requires
the CLI package to be built first because the bin points at
`packages/cli/dist/index.js`.

Use `pnpm ci:check` before opening a pull request, changing release packaging,
or handing off broad work. It mirrors the credential-free CI job by running
`pnpm check`, `pnpm generated:check`, `pnpm examples:smoke`, and
`pnpm consumer:smoke` in one command.

Use `pnpm commands` when you want the short terminal guide instead of scanning
the full root script table. It groups the first-hour setup, mock smoke run,
artifact inspection, normal validation, iteration, examples, package,
formatting, release-intent, live-provider, and support commands.
Use `pnpm --silent commands -- --json` when automation needs the same curated
command map plus example and support references without scraping terminal text.

`pnpm setup:check` is intentionally fast and does not run `pnpm install`. It
checks the active Node and pnpm versions, `.nvmrc`, `.node-version`,
`.editorconfig`, `.env.example`, `AGENTS.md`, `.npmrc`, `package.json`,
`pnpm-workspace.yaml`, CI/release workflows, `.gitignore`, `.ignore`,
`.prettierignore`, and ESLint ignores for setup, editor-default, env-template,
agent-guidance, and artifact-ignore drift.

`pnpm clean -- --dry-run` lists ignored local outputs across the repo, including
package `dist/` directories, coverage directories, `.tsbuildinfo` files, and
local `.harness` artifacts. It does not delete by default; use
`pnpm clean -- --yes` only when removing those ignored outputs is intentional.

`pnpm setup:doctor` is the first-hour setup health check. It runs
`pnpm setup:check`, builds all packages, then runs
`pnpm hk doctor --provider mock` against the built CLI.

`pnpm test` also builds first because package-manifest smoke tests import built
package entrypoints and inspect `dist/index.js` dependencies. This keeps the
common test command from validating stale build output.

## Targeted Test Loops

Use a package or Vitest project loop while iterating, then run the broader gate
before handoff:

| Need                                     | Command                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Run one package's test script            | `pnpm --filter @metaharness/cli test`                                     |
| List Vitest projects and examples        | `pnpm test:project -- --help`                                             |
| Run one Vitest project without build     | `pnpm test:project -- cli`                                                |
| Run one test file                        | `pnpm test:project -- cli packages/cli/test/cli.test.ts`                  |
| Run one named test                       | `pnpm test:project -- cli packages/cli/test/cli.test.ts -t "run command"` |
| Run mock integration conformance         | `pnpm test:integration`                                                   |
| Run live provider conformance            | `metaharness_TEST_CODEX=1 OPENAI_API_KEY=... pnpm test:live`              |
| Finish a broad source change             | `pnpm check`                                                              |
| Finish release, example, or package work | `pnpm ci:check`                                                           |

Vitest project names are `core`, `adapter-mock`, `policy`, `telemetry`,
`claude`, `cursor`, `codex`, `cli`, `github-action`, and `integration`. Package
test scripts run the matching project through the package workspace; for
example, `pnpm --filter @metaharness/codex test` runs the `codex` project.
`pnpm test:project -- <name>` is a thin wrapper around
`pnpm exec vitest run --project <name>`. It validates the project name, forwards
file filters and `-t` patterns to Vitest, uses the repo aliases from
`vitest.config.ts`, and does not build first. Use `pnpm test` when package
entrypoints, generated artifacts, or build output are part of what you need to
verify.

`pnpm package:check` runs `pnpm pack` for every publishable package into a
temporary directory, inspects the actual tarball, and fails if README files,
README local links, exported files, bin targets, `action.yml`, concrete
internal dependency versions, or optional provider peer metadata would be wrong
for consumers.

`pnpm consumer:smoke` packs every publishable package, installs those tarballs
into temporary downstream projects with pnpm, imports `@metaharness/core` and
`@metaharness/adapter-mock`, runs the installed `hk` binary against the mock
provider, and verifies the first-run artifact workflow with `hk runs`,
`hk stream latest`, and `hk ledger show latest`. It also checks a CLI-only
install that depends on `@metaharness/cli` without direct core or adapter
dependencies. CI and release publishing run this check because it covers the
actual consumer install path and the newest-run inspection path users see in the
docs.

`pnpm cli:help:check` runs the built `hk` entrypoint and checks help output for
the root command, every primary command, and nested `docs`, `policy`, and
`ledger` subcommands. Use it after adding, renaming, or changing CLI options.

`pnpm docs:check` runs every documentation drift check, including CLI reference,
validation guidance, Markdown links, verified sources, error codes, policy
examples, public TypeScript snippets, and example README discoverability. Use it
as the first broad docs gate when a docs or examples change touches more than
one narrow surface.

`pnpm docs:cli:check` verifies the public CLI reference covers the current
command surface, important option names, JSON behavior, and operational notes.
It also scans public Markdown bash blocks so `pnpm hk` JSON examples use
`pnpm --silent` and keep stdout parseable. Use it with `pnpm cli:help:check`
after changing CLI commands or command docs.

`pnpm docs:validation:check` verifies the troubleshooting validation-drift table,
root README command list, this guide's Root Scripts table, contributor
validation guidance, and documented command expansions stay aligned with the
root script surface. Use it after adding, renaming, or changing validation
scripts or troubleshooting recovery guidance.

`pnpm docs:links:check` scans Markdown files outside ignored build/artifact
directories, validates local file, directory, and Markdown heading-anchor links,
and verifies every `docs/*.md` file is linked from both `docs/README.md` and the
root README Documentation section. It also verifies the root README Repository
Status list and this guide's Package Map include every workspace package under
`packages/`. Use it after moving docs, examples, package READMEs, docs index
entries, or workspace packages.

`pnpm docs:sources:check` verifies `docs/verified-sources.md` has a checked
date and covers the required provider SDK, protocol, GitHub Actions,
OpenTelemetry, and build-tooling source references. Use it after changing source
verification notes or provider/tooling claims that depend on external docs.

`pnpm docs:error-codes:check` compares uppercase code-like string literals under
`packages/*/src` with backticked entries in `docs/error-codes.md`. Use it after
adding, renaming, or removing typed errors or policy diagnostics.

`pnpm docs:policy:check` builds `@metaharness/policy`, validates standalone
public YAML fences that look like metaharness policy files, and also validates
literal strings passed to `parsePolicyYaml()` in public TypeScript snippets. Use
it after changing policy docs, generated init examples, or policy package
examples.

`pnpm docs:snippets:check` extracts public TypeScript code fences from the root
README, docs, examples, and package READMEs, typechecks them against the repo
path aliases, and fails public examples that branch on provider strings instead
of `ProviderCapabilities`. Use it after changing public examples, config fields,
or SDK signatures.

`pnpm artifacts:clean -- --dry-run` lists ignored local `.harness` artifact
targets such as runs, compares, and worktrees. It does not delete by default;
use `pnpm artifacts:clean -- --yes` only when you intentionally want to remove
local metaharness artifacts.

Use `pnpm clean -- --dry-run` when you want to inspect every ignored local output
category at once. It includes package `dist/` directories, coverage,
`.tsbuildinfo`, and the same local `.harness` artifact targets.

`pnpm examples:docs:check` verifies each immediate `examples/` directory has a
README, is linked from the examples index, and includes a fenced `pnpm` command
path that can be run from the repository root. Use it after adding, renaming, or
moving examples.

Use `pnpm --silent hk ... --json` for machine-readable CLI output through pnpm.
The `--silent` flag suppresses pnpm's script banner so stdout remains pure JSON.

## Adapter Work

Before changing a provider adapter:

1. Read `docs/adapters.md` and `docs/provider-capabilities.md`.
2. Inspect `packages/core/src/types/capabilities.ts`,
   `packages/core/src/types/events.ts`, and the target adapter tests.
3. Verify current provider SDK behavior from official docs when SDK syntax or
   runtime behavior matters.
4. Update capability notes before mapping new behavior into examples.

Adapter expectations:

- Use dynamic imports for provider SDKs.
- Keep provider SDKs external in package builds.
- Keep provider SDK peer dependencies optional.
- Emit only valid `PortableRunEvent` values.
- Emit raw provider payloads as `provider.raw`; core decides whether to store
  them.
- Do not synthesize plan, tool, command, file, usage, or artifact events that the
  provider did not expose or core did not observe.
- Throw `UnsupportedCapabilityError` before calling unsafe or unsupported native
  operations.

## Policy And Security Work

Policy is defense in depth, not a formal sandbox guarantee. When editing policy
logic:

- Preserve provider-native warnings.
- Keep command parsing direct and auditable.
- Use argv arrays and `execFile`, not shell interpolation.
- Treat `.harness/` as sensitive.
- Keep `diff.patch` applyable, even though that means it is not rewritten by the
  run-store redaction layer.
- Rerun policy tests and integration conformance.

## CLI Work

For CLI changes:

- Keep human output concise and stable.
- Keep `--json` output machine-readable with no extra prose from the CLI itself.
  In repo docs, use `pnpm --silent hk ... --json` when the command is piped or
  parsed.
- Treat `--json` and `--stream` as mutually exclusive. Streaming events are
  human-readable stdout; JSON output must remain parseable as a single document.
- Resolve `--task-file` relative to `--cwd`.
- Keep provider-specific options explicit. For example, Cursor cloud repository
  flags should fail for non-Cursor providers and non-cloud runtime.
- Add tests in `packages/cli/test/cli.test.ts` for parsing, output, and artifact
  behavior.

## Live Provider Test Gates

| Surface               | Gate                                 | API key             |
| --------------------- | ------------------------------------ | ------------------- |
| Claude Agent SDK      | `metaharness_TEST_CLAUDE=1`          | `ANTHROPIC_API_KEY` |
| Cursor SDK            | `metaharness_TEST_CURSOR=1`          | `CURSOR_API_KEY`    |
| Codex SDK mode        | `metaharness_TEST_CODEX=1`           | `OPENAI_API_KEY`    |
| Codex app-server mode | `metaharness_TEST_CODEX_APPSERVER=1` | `OPENAI_API_KEY`    |

`pnpm test:live` fails fast when no live provider gate is set, so a mock-only
integration run cannot be mistaken for live coverage. Live provider gates must
be set to exactly `1`; values like `true` are ignored and reported before Vitest
starts. Run `pnpm test:live -- --help` to print the provider gate/API-key matrix
without starting Vitest. Use `pnpm test:integration` for mock-only integration
conformance. Run one provider gate at a time while debugging, then run the
aggregate gate after the issue is fixed. Never print key values.
[.env.example](../.env.example) is the placeholder-only checklist for the same
variables; the repo does not auto-load it, and real `.env` files remain ignored.
Its gate values are blank by default so copying it does not enable live provider
tests.

macOS `launchctl` example:

```bash
ANTHROPIC_API_KEY="$(launchctl getenv ANTHROPIC_API_KEY)" \
CURSOR_API_KEY="$(launchctl getenv CURSOR_API_KEY)" \
OPENAI_API_KEY="$(launchctl getenv OPENAI_API_KEY)" \
metaharness_TEST_CLAUDE=1 \
metaharness_TEST_CURSOR=1 \
metaharness_TEST_CODEX=1 \
metaharness_TEST_CODEX_APPSERVER=1 \
pnpm test:live
```

## Generated Artifacts

Do not edit generated capability docs or schemas without understanding their
source:

| Generated file                           | Source of truth                                         | Focused refresh command     |
| ---------------------------------------- | ------------------------------------------------------- | --------------------------- |
| `docs/provider-capabilities.md`          | `docsCapabilitiesCommand()` and adapter capability maps | `pnpm docs:capabilities`    |
| `schemas/metaharness.config.schema.json` | `configJsonSchema()` from `@metaharness/core`           | `pnpm schemas:generate`     |
| `schemas/metaharness.policy.schema.json` | `policyJsonSchema()` from `@metaharness/policy`         | `pnpm schemas:generate`     |
| `schemas/event.schema.json`              | `eventJsonSchema()` from `@metaharness/core`            | `pnpm schemas:generate`     |
| `schemas/session-ledger.schema.json`     | `sessionLedgerJsonSchema()` from `@metaharness/core`    | `pnpm schemas:generate`     |
| Package `dist/` directories              | Package source compiled by `tsup`                       | `pnpm build`                |
| `.harness/` run artifacts                | Local `hk` and SDK runs in the active workspace         | create a run; do not commit |

Use `pnpm generated:write` to refresh every committed generated artifact in one
pass. Use the focused command when you intentionally changed only capability
metadata or only JSON Schema sources.

After capability changes:

```bash
pnpm generated:write
pnpm generated:check
pnpm test
```

CI runs `pnpm generated:check` to compare `docs/provider-capabilities.md` and
files under `schemas/` against generated output without rewriting files. If that
step fails, run `pnpm generated:write` locally, then inspect the resulting
markdown or JSON changes before committing them. Use `pnpm docs:capabilities` or
`pnpm schemas:generate` when you intentionally want to refresh only one
generated artifact family.

## Release Workflow

Release intent is tracked with Changesets:

```bash
pnpm changeset
```

Select every affected package, choose the semver bump, and write a concise
summary that will make sense in a package changelog. For publishable changes,
include the generated changeset file in the pull request.

`.changeset/config.json` keeps public npm access, `main` as the base branch,
Changesets changelog generation, non-committing local commands, private root
version bookkeeping without private tags, and patch-level internal dependency
updates aligned with the release workflow.

The release workflow runs on pushes to `main` and can also be rerun manually
with `workflow_dispatch`. It uses `changesets/action` with two explicit root
scripts:

- `pnpm version:packages` applies pending changesets to package versions and
  changelogs when a version pull request is needed.
- `pnpm release:publish` runs `pnpm ci:check`, then calls `changeset publish`
  after the version pull request has been merged. Because `pnpm ci:check`
  includes `pnpm check`, generated artifact checks, credential-free examples,
  and the downstream consumer install smoke, the release path verifies package
  tarballs before publishing and then verifies that the tarballs install in a
  downstream consumer project.

The workflow requires the repository secret `NPM_TOKEN`. It also passes
`NODE_AUTH_TOKEN` for npm registry authentication and uses the built-in
`GITHUB_TOKEN` to create or update the version pull request. Run
`pnpm release:check` after editing `.changeset/config.json`,
`.github/workflows/release.yml`, or any root release script; `pnpm check`
includes that guard.

## Troubleshooting

Use [Troubleshooting](troubleshooting.md) for setup, provider SDK, API key, CLI
JSON output, generated artifact, GitHub Actions, and known provider caveat
recovery paths.
