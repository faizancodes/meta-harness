# Conformance

Conformance protects the portable contract across adapters.

## Always-On Tests

CI always runs:

```bash
pnpm ci:check
```

The mock adapter tests are always on. They verify deterministic lifecycle events,
event recording, ledger generation, handoff rendering, compare summaries, policy
checks, workspace diff capture, telemetry behavior, CLI commands, and GitHub
Action smoke behavior.

CI also runs credential-free example smoke tests and a downstream consumer smoke
that installs packed package tarballs into a temporary project before importing
the SDK and running the installed `hk` binary.

The root integration project also runs `tests/integration/conformance.test.ts`.
It verifies the mock provider on every `pnpm test` run, using a generated tiny
workspace under the OS temp directory. The suite checks capability matrix shape,
streamed portable events, event schema validity, monotonic `seq`, raw-event
gating, `result.json`/`ledger.json`/`handoff.md` artifact paths, and the handoff
warning that hidden provider-native session state is not transferred.

The integration mock conformance path exercises the public active lifecycle:

- `harness.startRun()` returns a run id, replayable event stream, and `wait()`
- generated events remain valid, monotonic, and persisted to run artifacts
- raw provider events remain disabled in normalized logs by default
- edit-style runs produce a diff event, result diff, or patch artifact
- observed command events that violate policy fail the run with a typed error
- active cancellation resolves to a cancelled mock result
- resume from a prior ledger works through the same public harness API

Package-local mock tests cover deterministic event ordering, artifact generation,
active cancellation, and resume session metadata separately.

## Provider-Gated Tests

Real provider tests are gated by environment variables so normal CI does not
require provider credentials or optional peer installs:

| Env var                              | Provider surface         |
| ------------------------------------ | ------------------------ |
| `metaharness_TEST_CLAUDE=1`          | Claude Agent SDK adapter |
| `metaharness_TEST_CURSOR=1`          | Cursor SDK adapter       |
| `metaharness_TEST_CODEX=1`           | Codex SDK mode           |
| `metaharness_TEST_CODEX_APPSERVER=1` | Codex app-server mode    |

The same conformance file defines Claude, Cursor, and Codex suites, but those are
skipped unless both the provider gate and its API key environment variable are
present:

| Provider              | Gate                                 | Required API key env |
| --------------------- | ------------------------------------ | -------------------- |
| Claude                | `metaharness_TEST_CLAUDE=1`          | `ANTHROPIC_API_KEY`  |
| Cursor                | `metaharness_TEST_CURSOR=1`          | `CURSOR_API_KEY`     |
| Codex SDK mode        | `metaharness_TEST_CODEX=1`           | `OPENAI_API_KEY`     |
| Codex app-server mode | `metaharness_TEST_CODEX_APPSERVER=1` | `OPENAI_API_KEY`     |

If a provider gate is enabled without the matching API key env var, the preflight
test fails with an explicit setup message instead of attempting a provider run.

`pnpm test:live` fails before Vitest when no live provider gate is set. Live
provider gates must be set to exactly `1`; values like `true` are ignored and
reported before Vitest starts. Use `pnpm test:integration` for mock-only
integration conformance. Use [.env.example](../.env.example) as the
placeholder-only checklist for gate and API-key names; the repo does not
auto-load it, and its gate values are blank by default.

Provider conformance should continue expanding toward:

- optional peer dependency loading
- start, stream, wait, cancel, and resume where supported
- typed `UnsupportedCapabilityError` for unsupported operations
- portable event validity and monotonic `seq`
- raw event gating
- redaction in event/result/ledger files
- capability matrix honesty
- edit/diff behavior and deny-command policy checks for capability-matched providers
- provider-native artifacts such as PR URLs only when exposed by the provider

## Local Commands

Use full verification before publishing changes:

```bash
pnpm install --frozen-lockfile
pnpm ci:check
```

`pnpm ci:check` expands to:

```bash
pnpm check
pnpm generated:check
pnpm examples:smoke
pnpm consumer:smoke
```

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

`pnpm test` runs `pnpm build` before Vitest. The package-manifest smoke tests
import built package entrypoints and inspect `dist/index.js`, so the standard
test path must validate fresh build output rather than stale files.

CI checks committed docs and schema artifacts inside `pnpm ci:check` and fails
if they differ from generated output. The non-mutating check command is:

```bash
pnpm generated:check
```

For generated docs:

```bash
pnpm docs:capabilities
```

For generated JSON Schemas:

```bash
pnpm schemas:generate
```

To refresh every committed generated artifact in one pass:

```bash
pnpm generated:write
```

Set `metaharness_OTEL_EXPORTER=none` when running CLI smoke commands if you do not
want telemetry exporters initialized.

To run only the integration conformance project:

```bash
pnpm test:integration
```

Run `pnpm test:live -- --help` to print live provider gate help without starting
Vitest:

```bash
pnpm test:live -- --help
```

With live Codex SDK conformance enabled:

```bash
metaharness_TEST_CODEX=1 OPENAI_API_KEY=... pnpm test:live
```

## Doctor

`hk doctor` checks local readiness before conformance or live runs:

- Node version
- package manifest, lockfile, and dependency install hints
- policy parse or inline policy validation
- git status and clean-worktree requirements
- writable `.harness` storage
- mock adapter smoke
- provider adapter registration
- provider SDK package installation
- provider API key presence

Use `hk doctor --provider mock --json` for machine-readable checks. Without
`--provider`, doctor checks the active config `defaultProvider`, or `mock` when
no config default is set. Use `hk doctor --provider <provider>` before a
targeted live run, and use
`hk doctor --all` only when every provider is intentionally configured. Real
provider package and API key checks are reported as failures only for the
selected provider(s); non-git workspaces and missing package metadata are
warnings unless the active config requires a clean git workspace. Human doctor
output includes a `next` section when warnings or failures have obvious setup
actions.
