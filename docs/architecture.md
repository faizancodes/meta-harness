# Architecture

metaharness is a TypeScript-first harness layer for coding agents. It normalizes
the operational parts of running agents while keeping provider-specific behavior
visible through `ProviderCapabilities`.

## Layers

| Layer          | Package                                                                                         | Responsibility                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Core contracts | `@metaharness/core`                                                                             | `createHarness()`, run lifecycle, portable events, run storage, workspace/git capture, session ledgers, compare, handoff, errors. |
| Policy         | `@metaharness/policy`                                                                           | Parse policy files, compile provider-native policy hints, expose harness-level guards and diagnostics.                            |
| Telemetry      | `@metaharness/telemetry`                                                                        | Optional OpenTelemetry setup for spans emitted by core.                                                                           |
| Adapters       | `@metaharness/claude`, `@metaharness/cursor`, `@metaharness/codex`, `@metaharness/adapter-mock` | Convert provider SDK/config/event surfaces into portable run handles, events, and results.                                        |
| CLI            | `@metaharness/cli`                                                                              | `hk init`, `hk run`, `hk resume`, `hk stream`, `hk compare`, `hk handoff`, `hk ledger`, `hk policy`, `hk docs`.                   |
| GitHub Action  | `@metaharness/github-action`                                                                    | CI entry point around the same harness API.                                                                                       |

## Run Flow

1. `createHarness(config, adapters)` registers concrete adapters.
2. `harness.agent(provider).capabilities()` returns the capability matrix for UI,
   automation, and examples to branch on.
3. `harness.startRun({ task, provider })` prepares a workspace, starts a native provider
   session, runs the task, streams normalized events, waits for completion, captures
   verification output, captures workspace diff, and writes artifacts. It returns
   once a provider run id is available, with `events()`, `wait()`, and `cancel()`
   methods.
4. Core writes `.harness/runs/<run-id>/events.ndjson`, `result.json`,
   `ledger.json`, `handoff.md`, `diff.patch`, and `verification.log`.
   `RunResult.verificationLogPath` points to the verification log, even when no
   verification commands were configured.
5. `harness.compare()` runs the same task across providers, optionally with isolated
   worktrees and bounded `strategy.maxConcurrency`, and writes
   `.harness/compares/<compare-id>/`.
6. `harness.handoff()` renders a prompt from the source ledger and diff, then starts
   the target provider with explicit context.

`harness.run()` and `agent.run()` are blocking convenience wrappers around the
same lifecycle. Use `startRun()` when application code needs live event
consumption or cancellation.

Compare runs are sequential by default. When `strategy.maxConcurrency` is greater
than one, metaharness schedules that many provider runs at a time, preserves output
ordering by the input provider list, and still writes one ledger, patch, and result
per provider. `stopOnFirstSuccess` stops scheduling new providers; it does not
discard or auto-merge providers that were already running.

Git workspaces use `git diff --no-ext-diff --binary` and `git diff --numstat`
for high-fidelity patches and stats. Non-Git workspaces use a conservative text
snapshot fallback for small files and ignore `.harness`, `.git`, and
`node_modules`; binary or oversized files are reported as changed without trying
to synthesize binary patch content.

## Boundaries

metaharness does not pretend Claude, Cursor, and Codex are identical. The portable
API covers lifecycle, streaming, policy, telemetry, storage, diffs, compare, and
handoff. Provider-specific capabilities stay in `ProviderCapabilities` and native
adapter options.

metaharness does not replace MCP. MCP server configs and provider-native MCP
behavior pass through to adapters. metaharness adds policy, redaction, telemetry,
and ledger capture around those calls.

metaharness does not replace ACP or any editor protocol. It is a production SDK/CLI
for CI and internal platforms, not an editor UI wire protocol.

Native provider session state is not portable. metaharness stores explicit
portable context in `SessionLedger` and captures a patch. Handoff uses those
artifacts, not hidden Claude/Cursor/Codex state transfer.

## Storage

Default storage is rooted at `.harness` under `workspace.cwd`.

```text
.harness/
  runs/<run-id>/
    events.ndjson
    result.json
    ledger.json
    handoff.md
    diff.patch
    verification.log
    provider/raw-events.ndjson
  compares/<compare-id>/
    compare.json
    compare.md
```

Provider raw events are off by default. When enabled with `rawEvents: true` or
`RunInput.rawEvents`, raw events are written under `provider/raw-events.ndjson`
instead of the portable event log.

## Schemas

Committed JSON Schema artifacts live under `schemas/`:

- `metaharness.config.schema.json`
- `metaharness.policy.schema.json`
- `session-ledger.schema.json`
- `event.schema.json`

The config, event, and session-ledger schemas are generated from core Zod schemas.
The policy schema is generated from the policy package. Tests compare the committed
schema files against the generator output so schema drift is caught in CI.
Regenerate all committed schema files with `pnpm schemas:generate`.
