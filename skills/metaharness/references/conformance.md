# Conformance And Validation

Use this reference for repo validation, package checks, generated artifacts,
mock conformance, live provider gates, release checks, and failure triage.

## Table Of Contents

- Standard validation
- Narrow checks
- Full checks
- Generated artifacts
- Always-on tests
- Live provider gates
- Live test commands
- Doctor before live runs
- Known provider caveats
- Cleaning artifacts
- What a clean result means

## Standard Validation

For internal repo changes:

```bash
pnpm check
```

For release, package, example, generated artifact, or broad handoff work:

```bash
pnpm ci:check
```

For a fresh checkout or CI-equivalent local setup:

```bash
pnpm install --frozen-lockfile
pnpm ci:check
```

Run `pnpm build` before commands that execute the built CLI directly:

```bash
pnpm build
pnpm hk --help
```

## Narrow Checks

Use focused checks while iterating:

```bash
pnpm setup:check
pnpm lint
pnpm typecheck
pnpm test
pnpm docs:check
pnpm package:check
pnpm format
```

Useful targeted commands:

```bash
pnpm test:project -- cli
pnpm --filter @metaharness/core test
pnpm test:integration
pnpm docs:links:check
pnpm docs:policy:check
pnpm generated:check
pnpm examples:docs:check
```

Use `pnpm --silent commands -- --json` to discover the curated command map in
automation.

## Full Checks

`pnpm check` expands to:

```bash
pnpm setup:check
pnpm lint
pnpm typecheck
pnpm test
pnpm release:check
pnpm cli:help:check
pnpm docs:check
pnpm package:check
pnpm format
```

`pnpm ci:check` expands to:

```bash
pnpm check
pnpm generated:check
pnpm examples:smoke
pnpm consumer:smoke
```

`pnpm docs:check` expands to:

```bash
pnpm docs:cli:check
pnpm docs:validation:check
pnpm docs:links:check
pnpm docs:sources:check
pnpm docs:error-codes:check
pnpm docs:policy:check
pnpm docs:snippets:check
pnpm examples:docs:check
```

`pnpm test` runs `pnpm build` before Vitest so tests inspect fresh built package
entrypoints where needed.

## Generated Artifacts

Generated files include:

- `docs/provider-capabilities.md`
- `schemas/metaharness.config.schema.json`
- `schemas/metaharness.policy.schema.json`
- `schemas/event.schema.json`
- `schemas/session-ledger.schema.json`

Non-mutating check:

```bash
pnpm generated:check
```

Regenerate all:

```bash
pnpm generated:write
```

Regenerate capabilities:

```bash
pnpm docs:capabilities
```

Regenerate schemas:

```bash
pnpm schemas:generate
```

Do not manually patch generated docs or schemas as the only fix.

## Always-On Tests

Mock conformance runs in normal tests and verifies the portable contract:

- complete capability matrix shape
- `harness.startRun()` lifecycle
- replayable event streams
- valid portable events
- monotonic `seq`
- raw events disabled by default
- run result and ledger artifact paths
- handoff warning about non-portable native sessions
- edit-style diff or patch behavior
- policy-denied command failure when observable
- active cancellation semantics
- resume from prior ledger/native metadata where supported

Package tests cover:

- deterministic mock behavior
- event recording
- run storage
- ledger import/export
- compare summaries
- policy parsing and guards
- telemetry setup
- CLI commands
- GitHub Action smoke behavior
- package manifest expectations

Mock passing does not prove real provider behavior.

## Live Provider Gates

Real provider conformance is opt-in:

| Surface               | Gate                                 | API key env         |
| --------------------- | ------------------------------------ | ------------------- |
| Claude Agent SDK      | `metaharness_TEST_CLAUDE=1`          | `ANTHROPIC_API_KEY` |
| Cursor SDK            | `metaharness_TEST_CURSOR=1`          | `CURSOR_API_KEY`    |
| Codex SDK mode        | `metaharness_TEST_CODEX=1`           | `OPENAI_API_KEY`    |
| Codex app-server mode | `metaharness_TEST_CODEX_APPSERVER=1` | `OPENAI_API_KEY`    |

Gates must be exactly `1`. Values like `true` are ignored.

If a gate is enabled without the matching API key, conformance should fail
preflight with a clear setup message.

Do not run live tests unless credentials and gates are intentionally set.

## Live Test Commands

Before live runs:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm hk doctor --provider <provider>
```

Claude:

```bash
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
metaharness_TEST_CLAUDE=1 \
pnpm test:live -- -t claude
```

Cursor:

```bash
CURSOR_API_KEY="$CURSOR_API_KEY" \
metaharness_TEST_CURSOR=1 \
pnpm test:live -- -t cursor
```

Codex SDK:

```bash
OPENAI_API_KEY="$OPENAI_API_KEY" \
metaharness_TEST_CODEX=1 \
pnpm test:live -- -t "codex sdk"
```

Codex app-server:

```bash
OPENAI_API_KEY="$OPENAI_API_KEY" \
metaharness_TEST_CODEX_APPSERVER=1 \
pnpm test:live -- -t "codex app-server"
```

All live gates:

```bash
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
CURSOR_API_KEY="$CURSOR_API_KEY" \
OPENAI_API_KEY="$OPENAI_API_KEY" \
metaharness_TEST_CLAUDE=1 \
metaharness_TEST_CURSOR=1 \
metaharness_TEST_CODEX=1 \
metaharness_TEST_CODEX_APPSERVER=1 \
pnpm test:live
```

On macOS desktop sessions where the user set keys with `launchctl setenv`, inject
without printing:

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

Use help without starting Vitest:

```bash
pnpm test:live -- --help
```

## Doctor Before Live Runs

Use:

```bash
pnpm hk doctor --provider <provider>
```

Doctor checks:

- Node and pnpm versions
- package manifest and lockfile
- dependency installation hints
- config and policy validity
- git workspace state
- `.harness` writability
- adapter registration
- provider SDK peer installation
- API key presence

Use `--all` only when all providers are intentionally configured.

## Known Provider Caveats

Preserve these caveats in tests and docs:

- Mock proves portable harness behavior only.
- Claude sessions are provider-local and not portable across providers.
- Cursor SDK behavior is beta-sensitive.
- Cursor local cancellation is unsupported for `@cursor/sdk@1.0.17` until the
  SDK cancellation path is process-clean.
- Codex SDK mode has less event detail than app-server mode.
- Codex app-server mode is version-sensitive.
- Raw provider events are disabled by default for all real providers.

## Cleaning Artifacts

Clean local run artifacts:

```bash
pnpm artifacts:clean -- --dry-run
pnpm artifacts:clean -- --yes
```

Clean ignored build and harness outputs:

```bash
pnpm clean -- --dry-run
pnpm clean -- --yes
```

Cleanup targets include package `dist/`, coverage, `*.tsbuildinfo`, and selected
`.harness` run/compare/worktree artifacts. They do not remove `node_modules`.

## What A Clean Result Means

A clean validation means:

- TypeScript compiles.
- Lint and formatting are stable.
- Mock conformance and package tests pass.
- CLI docs and help output match command behavior.
- Generated docs and schemas match generators.
- Package tarballs are packable and importable.
- Consumer smoke tests can install and use packed packages.

It does not mean:

- every provider supports every capability
- hidden provider-native state is portable
- policy is a complete sandbox
- live provider behavior passed unless live gates were enabled
