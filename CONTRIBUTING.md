# Contributing

This repo optimizes for a clear provider-aware contract. Changes should make the
portable harness stronger without hiding real Claude, Cursor, or Codex
differences.

## Setup

```bash
corepack enable
pnpm install
pnpm setup:doctor
```

Use Node 22+ and pnpm 9.13+. `pnpm setup:check` verifies the active Node and
pnpm versions plus `.nvmrc`, `.node-version`, `.editorconfig`, `packageManager`,
root `engines`, `.npmrc`, `.env.example`, and ignore-hygiene checks so local
toolchain, editor-default, env-template, or artifact-ignore drift fails early.
Provider SDKs are optional peer dependencies for consumers, but this repo keeps
them available as dev dependencies so live conformance can be run when API keys
are present.
Use [.env.example](.env.example) as a placeholder-only checklist for live
provider gates and API-key variable names. The repo does not auto-load it; keep
real values in your shell, secret manager, or a local ignored `.env` file. Its
gate values are blank by default so copying it does not enable live provider
tests.

`pnpm setup:doctor` is the one-command fresh-clone health check. It verifies
repository setup, editor defaults, env template, agent guidance, and ignore
files, builds the packages, and runs the credential-free mock CLI doctor.

## Before Editing

Start with the [Development change map](docs/development.md#change-map). It maps
common change areas to the right source files, nearby tests or guards, and
public docs to keep in sync. Use it before choosing a package, updating a public
example, or deciding which narrow validation command to run first.

AI coding agents should also read [AGENTS.md](AGENTS.md) before editing. It
captures the provider-capability rules, Context7 documentation workflow, CLI
build expectation, sensitive artifact handling, and validation gates that are
easy to miss in automated sessions.

## Validation

Run the CI-equivalent check before handing off broad changes:

```bash
pnpm ci:check
```

For narrower local loops:

```bash
pnpm check
pnpm setup:check
pnpm lint
pnpm clean -- --dry-run
pnpm commands
pnpm typecheck
pnpm typecheck:examples
pnpm test
pnpm test:project -- cli
pnpm test:integration
pnpm build
pnpm cli:help:check
pnpm docs:check
pnpm docs:cli:check
pnpm docs:validation:check
pnpm docs:links:check
pnpm docs:sources:check
pnpm docs:error-codes:check
pnpm docs:policy:check
pnpm docs:snippets:check
pnpm examples:docs:check
pnpm example:sdk
pnpm artifacts:clean -- --dry-run
pnpm setup:doctor
pnpm package:check
pnpm generated:check
pnpm generated:write
pnpm examples:smoke
pnpm consumer:smoke
pnpm release:check
pnpm format
pnpm format:write
```

Use `pnpm format:write` only when you want Prettier to rewrite files. Append
paths, such as `pnpm format:write docs/sdk.md`, when you want a scoped format
pass.

Use the narrow check that matches the files you changed before running the
broader gate:

| Change type                       | First checks to run                                                              |
| --------------------------------- | -------------------------------------------------------------------------------- |
| SDK or core behavior              | `pnpm typecheck`, `pnpm test`, then `pnpm check`                                 |
| CLI commands, help, or reference  | `pnpm build`, `pnpm cli:help:check`, `pnpm docs:cli:check`, then `pnpm check`    |
| Public TypeScript examples        | `pnpm docs:snippets:check`, `pnpm typecheck:examples`, then `pnpm check`         |
| Policy docs or examples           | `pnpm docs:policy:check`, `pnpm docs:snippets:check`, then `pnpm check`          |
| Error or diagnostic codes         | `pnpm docs:error-codes:check`, `pnpm docs:links:check`, then `pnpm check`        |
| Docs or examples                  | `pnpm docs:check`, then `pnpm check`                                             |
| Generated schemas or capabilities | `pnpm generated:check`, then `pnpm generated:write` if committed artifacts drift |
| Package manifests or release      | `pnpm package:check`, `pnpm consumer:smoke`, `pnpm release:check`                |
| Broad or handoff-ready work       | `pnpm ci:check`                                                                  |

For faster iteration, use the
[targeted test loops](docs/development.md#targeted-test-loops) before the
broader gate. For example, `pnpm --filter @metaharness/cli test` runs the CLI
package tests and `pnpm test:project -- cli` runs the CLI Vitest project without
building first.

## Reporting Issues

Start with [SUPPORT.md](SUPPORT.md) when you are not sure which document,
template, or validation command applies.

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) for
reproducible failures and the
[feature request template](.github/ISSUE_TEMPLATE/feature_request.md) for new
SDK, CLI, adapter, policy, docs, or workflow ideas. Both templates ask for the
provider, command or API surface, diagnostics, validation context, and
provider-capability impact so maintainers can triage without guessing. The
issue-template chooser disables blank issues for normal contributors so support
requests keep that context.

Do not paste API keys, tokens, private prompts, private transcripts, raw
provider logs, or sensitive `.harness/` artifacts into issues. Use
[SECURITY.md](SECURITY.md) for vulnerability handling or private security
reporting.

## Pull Request Handoff

Use the [pull request template](.github/PULL_REQUEST_TEMPLATE.md) as a final
checklist before handoff. It keeps validation, Changesets, generated artifacts,
provider-capability rules, optional SDK peer handling, raw-event defaults,
handoff claims, and `.harness/` artifact sensitivity visible at review time.

## Development Rules

- Branch application examples on `ProviderCapabilities`, not provider strings.
- Use official provider SDKs and dynamic imports in provider adapters.
- Keep provider SDKs as optional peer dependencies.
- Represent unsupported features honestly and throw `UnsupportedCapabilityError`
  when a public unsupported operation is called.
- Keep raw provider events disabled unless debugging adapter behavior.
- Do not put raw provider events in normalized `events.ndjson`.
- Do not claim provider-native sessions are portable. Use `SessionLedger`,
  `handoff.md`, `diff.patch`, and verification output for handoff.
- Do not build an MCP replacement or ACP/editor protocol replacement.
- Use argv arrays and `execFile` for harness-owned shell and git commands.
- Redact logs and generated artifacts that may contain secrets.

## Live Provider Conformance

Live tests are opt-in and require the matching API key variables. Run
`pnpm test:live -- --help` to print the provider gate/API-key matrix without
starting Vitest:

```bash
pnpm test:live -- --help
ANTHROPIC_API_KEY=... metaharness_TEST_CLAUDE=1 pnpm test:live
CURSOR_API_KEY=... metaharness_TEST_CURSOR=1 pnpm test:live
OPENAI_API_KEY=... metaharness_TEST_CODEX=1 pnpm test:live
OPENAI_API_KEY=... metaharness_TEST_CODEX_APPSERVER=1 pnpm test:live
```

All live gates together:

```bash
ANTHROPIC_API_KEY=... \
CURSOR_API_KEY=... \
OPENAI_API_KEY=... \
metaharness_TEST_CLAUDE=1 \
metaharness_TEST_CURSOR=1 \
metaharness_TEST_CODEX=1 \
metaharness_TEST_CODEX_APPSERVER=1 \
pnpm test:live
```

`pnpm test:live` fails fast when no live provider gate is set. Live provider
gates must be set to exactly `1`; values like `true` are ignored and reported
before Vitest starts. Use `pnpm test:integration` for mock-only integration
conformance. Use environment references or secret injection instead of literal
key values when running all live gates together. [.env.example](.env.example)
lists the same variables with empty placeholders and blank gate defaults.

Never print API keys in logs or docs. On macOS desktop sessions, keys set with
`launchctl setenv` can be injected with `$(launchctl getenv NAME)` without
displaying their values.

## Generated Docs And Schemas

Provider capabilities are generated from installed adapters:

```bash
pnpm build
pnpm docs:capabilities
```

Schema files under `schemas/` are covered by tests. If a schema drift test fails,
regenerate them and rerun `pnpm test`:

```bash
pnpm generated:write
pnpm generated:check
pnpm test
```

## Changesets

Use Changesets for package version intent:

```bash
pnpm changeset
```

Select affected packages, choose the semver bump, and write a concise summary.
Include the generated changeset file in any pull request that changes public
package behavior, APIs, CLI output, or docs that should appear in a changelog.

Release automation runs on pushes to `main`. When pending changesets exist,
`changesets/action` opens or updates a version pull request using
`pnpm version:packages`. After that version pull request is merged, the same
workflow validates the repo with `pnpm release:publish` and publishes packages
with `changeset publish`.

The publish step requires the repository secret `NPM_TOKEN`. If you edit
`.changeset/config.json`, release scripts, package manifests, tarball contents,
or `.github/workflows/release.yml`, run the release wiring check first, then the
broader gate before handoff:

```bash
pnpm release:check
pnpm ci:check
```

## More Detail

Read [docs/development.md](docs/development.md) for package layout, common
workflows, troubleshooting, generated artifacts, release workflow, and
adapter-specific review guidance.
