# CLI Reference

`hk` is the metaharness command-line entry point for local development, CI,
provider conformance, run artifacts, compare, and handoff workflows.

Inside this repository, build packages before running the CLI because the root
`pnpm hk` script executes `packages/cli/dist/index.js`:

```bash
pnpm build
pnpm hk --help
```

In a consumer workspace, install `@metaharness/cli` and run `pnpm exec hk ...`.
The CLI package already includes the metaharness adapter packages; install only
the optional provider SDK peers for providers you actually run.

## Global Options

```bash
pnpm hk --cwd <path> --config <path> <command>
```

- `--cwd <path>`: workspace root. Defaults to the current process directory.
  The path must exist and be a directory.
- `--config <path>`: config file path, resolved from `--cwd`.

The default config path is `metaharness.config.ts`; the default policy path is
`metaharness.policy.yaml`. If the default config file is absent, commands use a
mock-only fallback config. If you pass `--config <path>`, that file must exist.
See [Configuration](configuration.md) for config fields, provider entries,
storage, telemetry, and raw-event behavior.

Supported providers are `mock`, `claude`, `cursor`, and `codex`.

Use `pnpm --silent hk ... --json` when another command parses stdout. Without
`--silent`, pnpm may print its own script banner before the JSON.

Do not combine `--json` and `--stream`. JSON output is one machine-readable
document. Streaming output is human-readable event text.

When a command fails with a typed metaharness error or diagnostic, stderr
includes the stable error code before the message, for example
`error: CLI_USAGE_ERROR: ...`, `error: WORKSPACE_NOT_FOUND: ...`,
`error: CONFIG_NOT_FOUND: ...`, `error: INIT_TARGET_EXISTS: ...`,
`error: PROVIDER_UNSUPPORTED: ...`, `error: TASK_FILE_NOT_FOUND: ...`,
`error: OUTPUT_MODE_CONFLICT: ...`, `error: RUN_ARTIFACT_NOT_FOUND: ...`, or
`error: POLICY_CHECK_FAILED: ...`. Use the code with [Error codes](error-codes.md),
[Troubleshooting](troubleshooting.md), and artifact paths to identify the fix.

## Initialize

Create config, policy, and harness ignore files in a workspace:

```bash
WORKDIR="$(mktemp -d)"
pnpm hk --cwd "$WORKDIR" init --providers mock
```

Create a GitHub Actions workflow too:

```bash
WORKDIR="/path/to/workspace"
pnpm hk --cwd "$WORKDIR" init --providers codex --ci github
```

`hk init` creates:

- `metaharness.config.ts`
- `metaharness.policy.yaml`
- `.harness/.gitignore`
- `.github/workflows/metaharness.yml` when `--ci github` is passed

After init, check the generated workspace, run the credential-free mock
provider, and inspect the newest ledger from that same workspace:

```bash
pnpm hk --cwd "$WORKDIR" doctor --provider mock
pnpm hk --cwd "$WORKDIR" run --provider mock --task "Summarize this workspace"
pnpm hk --cwd "$WORKDIR" ledger show latest
```

Keep the same `--cwd "$WORKDIR"` on follow-up commands so config, policy,
storage, and `latest` resolve inside the initialized workspace.

It refuses to overwrite generated files unless `--force` is passed
intentionally. Use `--cwd` when initializing a different workspace from this
repository checkout. When real providers are selected, the output names the
optional provider SDK peer package and API key environment variable needed
before live runs.

When `--ci github` is selected, the generated workflow calls `pnpm exec hk`.
Install `@metaharness/cli` in that target workspace before expecting the
workflow to run. The CLI package already includes the metaharness adapter
packages; install selected provider SDK optional peers before running real
providers.

The generated config and policy are commented mock-first starting points. The
comments call out optional provider SDK peers, `.harness` sensitivity, raw event
debugging, and policy allow-list review. Read [Configuration](configuration.md)
before adding provider-native options or changing storage, policy, telemetry, or
raw event capture.

## Doctor

Check the mock provider first:

```bash
pnpm hk doctor --provider mock
```

Check the real provider you are about to run:

```bash
pnpm hk doctor --provider codex
```

Use `--all` only when every provider is intentionally configured:

```bash
pnpm hk doctor --all
```

When `--provider` is omitted, `hk doctor` checks `defaultProvider` from the
active config, or `mock` when no config default is set.

Human output groups core and provider checks and prints a `next` section when a
warning or failure has an obvious setup action. When a failing check has an
underlying typed diagnostic, the human row includes the code before the message.
JSON output keeps the raw check list, including each check's `code` when one is
available. For real providers, the `provider SDK package installed` row checks
the optional provider SDK peer, while `<provider> adapter registered` checks the
metaharness adapter:

```bash
pnpm --silent hk doctor --provider codex --json
```

`hk doctor` exits nonzero with `DOCTOR_CHECKS_FAILED` when any check has status
`fail`. With `--json`, stdout is still the JSON report; use `pnpm --silent` when
another command parses it.

For common setup, provider, JSON output, and CI failure modes, see
[Troubleshooting](troubleshooting.md).

## Run

Start a run from an inline task:

```bash
pnpm hk run --provider mock --task "Summarize this workspace" --stream
```

Start a run from a task file resolved relative to `--cwd`:

```bash
pnpm hk --cwd "$WORKDIR" run --provider mock --task-file task.md
```

Useful options:

- `--provider <provider>`: `mock`, `claude`, `cursor`, or `codex`. When
  omitted, `hk run` uses `defaultProvider` from the active config, or `mock`
  when no config default is set.
- `--model <model>`: provider model.
- `--runtime <runtime>`: `local`, `cloud`, or `self-hosted`.
- `--task <task>` or `--task-file <path>`: exactly one non-whitespace prompt
  source is required.
- `--verify <command>`: repeatable verification command.
- `--stream`: print human-readable normalized events while the run is active.
- `--json`: print the final `RunResult` as JSON.
- `--raw-events`: store redacted provider raw events in
  `provider/raw-events.ndjson`.

Cursor cloud repository flags are intentionally provider-specific:

```bash
pnpm hk run \
  --provider cursor \
  --runtime cloud \
  --repo https://github.com/org/repo \
  --starting-ref main \
  --auto-create-pr \
  --task "Fix failing tests"
```

Those repository flags fail for non-Cursor providers and non-cloud runtime.

`hk run` exits nonzero with `RUN_RESULT_FAILED` when the final `RunResult.status`
is `failed` or `cancelled`. With `--json`, stdout is still the `RunResult`; use
the process exit code for CI pass/fail.

Human output includes a `next` section with artifact inspection commands for the
new run id: `hk ledger show <run-id>`, `hk stream <run-id>`,
`hk ledger handoff <run-id>`, and `hk runs`.

## Runs

List recent run artifacts when you need to find an older run id:

```bash
pnpm hk runs
pnpm hk runs --limit 5
```

Use JSON for automation:

```bash
pnpm --silent hk runs --json
```

`hk runs` reads from the active `--cwd`, `--config`, and `storage.rootDir`, then
prints the run id, status, provider, update time, and a short summary. Human
output also prints the next artifact commands for the most recent run:
`hk ledger show latest`, `hk stream latest`, `hk ledger handoff latest`, and
`hk runs --json`. Keep the same `--cwd` and `--config` when using `latest` or
inspecting a prior run. Use `latest` with artifact commands when you only need
the most recent run:

```bash
pnpm hk ledger show latest
pnpm hk stream latest
pnpm hk ledger handoff latest
```

Useful options:

- `--limit <count>`: maximum number of recent runs to list. The value must be a
  positive integer; invalid values fail with `NUMERIC_OPTION_INVALID`.
- `--json`: print `{ runsRoot, runs }` as JSON.

## Resume

Resume a provider-native session with the same provider:

```bash
pnpm hk resume \
  --provider codex \
  --session <native-session-id> \
  --task "Continue the previous work"
```

Continue from a previous metaharness run ledger:

```bash
pnpm hk resume \
  --run <run-id> \
  --task "Continue from this run and address remaining failures"
```

`--run` loads the previous ledger and uses its provider unless `--provider` is
passed. It may also use `ledger.provider.nativeSessionId` when available. This is
same-provider continuation, not cross-provider hidden state transfer.

Useful options:

- `--provider <provider>`: override the provider inferred from `--run`.
- `--model <model>`: provider model.
- `--runtime <runtime>`: `local`, `cloud`, or `self-hosted`.
- `--session <native-session-id>`: same-provider native session id.
- `--run <run-id>`: prior metaharness run id.
- `--task <task>` or `--task-file <path>`: exactly one non-whitespace
  continuation prompt.
- `--verify <command>`: repeatable verification command.
- `--raw-events`: store redacted provider raw events in
  `provider/raw-events.ndjson`.
- `--json`: print the final `RunResult` as JSON.
- `--stream`: print human-readable normalized events while the run is active.

`hk resume` uses the same exit-code rule as `hk run`: non-success run results
exit nonzero with `RUN_RESULT_FAILED` after writing human or JSON output.
Human output includes the same `next` artifact commands as `hk run`:
`hk ledger show <run-id>`, `hk stream <run-id>`,
`hk ledger handoff <run-id>`, and `hk runs`.

## Artifacts And Ledger

Runs write artifacts under `.harness/runs/<run-id>/`:

```text
events.ndjson
result.json
ledger.json
handoff.md
diff.patch
verification.log
provider/raw-events.ndjson
```

Use `latest` in place of `<run-id>` to inspect the most recent run under the
active `--cwd`, `--config`, and `storage.rootDir`. Keep those options the same
when using `latest` or inspecting a prior run. Use the explicit run id printed
by `hk run` when you need an older run.

Show a concise human summary:

```bash
pnpm hk ledger show <run-id>
pnpm hk ledger show latest
```

Human summary output includes a `next` section with follow-up commands for the
resolved run id: `hk stream <run-id>`, `hk ledger export <run-id> --out
ledger.json`, `hk ledger handoff <run-id>`, and `hk runs`.

Export the full portable `SessionLedger`:

```bash
pnpm --silent hk ledger show <run-id> --json
pnpm --silent hk ledger export <run-id>
pnpm hk ledger export <run-id> --out ledger.json
```

Render the handoff prompt:

```bash
pnpm hk ledger handoff <run-id>
pnpm hk ledger handoff <run-id> --out handoff.md
```

Without `--out`, `ledger export` prints the portable `SessionLedger` JSON to
stdout and `ledger handoff` prints the markdown handoff prompt to stdout. Use
`pnpm --silent` when another tool parses JSON. With `--out`, relative paths
resolve from `--cwd` and parent directories are created when needed.

Replay logs:

```bash
pnpm hk stream <run-id>
pnpm hk stream latest
pnpm hk stream <run-id> --raw
```

Raw logs exist only when raw event capture was enabled.

## Handoff

Move work between providers using explicit artifacts:

```bash
pnpm hk handoff \
  --from-run <run-id> \
  --to codex \
  --instruction "Finish verification and keep the patch minimal." \
  --apply-patch \
  --verify "pnpm test"
```

Handoff uses `SessionLedger`, `handoff.md`, `diff.patch`, and verification
output. It does not transfer hidden provider-native session state.

Human output prints the handoff prompt path, destination run status, and the
same `next` artifact commands as `hk run`: `hk ledger show <run-id>`,
`hk stream <run-id>`, `hk ledger handoff <run-id>`, and `hk runs`.

Useful options:

- `--from-run <run-id>`: source run id.
- `--to <provider>`: destination provider.
- `--instruction <text>`: additional handoff instruction.
- `--apply-patch`: apply the source run patch before starting the destination.
- `--verify <command>`: repeatable verification command.
- `--json`: print JSON result.

## Compare

Run the same task across providers:

```bash
pnpm hk compare \
  --providers mock,codex \
  --task-file task.md \
  --verify "pnpm test" \
  --isolated-worktrees \
  --max-concurrency 2
```

Compare writes:

```text
.harness/compares/<compare-id>/compare.json
.harness/compares/<compare-id>/compare.md
```

Human output and `compare.md` include each provider run id so you can inspect the
ledger and stream for the result you want to keep. Human output also includes a
`next` section pointing to the markdown report, `hk ledger show <run-id>`,
`hk stream <run-id>`, and `hk runs`.

It does not auto-merge provider output. Inspect patch, ledger, verification, and
usage before selecting a result.

Useful options:

- `--providers <list>`: comma-separated provider ids.
- `--task <task>` or `--task-file <path>`: exactly one non-whitespace
  comparison prompt.
- `--verify <command>`: repeatable verification command.
- `--isolated-worktrees`: run each provider in an isolated git worktree.
- `--max-concurrency <count>`: limit concurrent provider runs.
- `--json`: print JSON result.

`hk compare` exits nonzero with `COMPARE_FAILED` when any provider run has a
non-success status or when configured verification fails for any provider.
Compare artifacts are still written before the command exits.

## Policy

Validate policy:

```bash
pnpm hk policy check --policy-file metaharness.policy.yaml --provider codex
```

Compile provider-native hints and harness guards:

```bash
pnpm --silent hk policy compile --provider codex --json
```

`policy check` exits nonzero when validation fails. `policy compile` exits
nonzero when the policy cannot be parsed or validated; provider warnings remain
advisory and are included in the output.

Use `policy check` before a run to validate syntax and portable metaharness
rules. Add `--provider <provider>` when you want provider-specific warnings for
the provider you are about to run. Use `policy compile` when you need to inspect
the provider-native policy hints and portable harness guards that would be
forwarded or enforced for one provider; it requires `--provider`.

Policy compilation is defense in depth, not a sandbox guarantee. Read
[Policy](policy.md) and [Security](security.md) before treating policy as a
control boundary.

Useful options:

- `--policy-file <path>`: policy file path, resolved from `--cwd`.
- `--provider <provider>`: include provider warnings or compile native hints for
  one provider.
- `--json`: print JSON diagnostics or compiled policy.

## Generated Docs

Render the provider capability matrix:

```bash
pnpm hk docs capabilities
pnpm --silent hk docs capabilities --json
```

Markdown output is intended for human documentation and includes the reminder to
branch application logic on `ProviderCapabilities` flags instead of provider
strings. JSON output is intended for scripts that need the current adapter
capability data.

Inside this repository, check committed generated artifacts with:

```bash
pnpm generated:check
```

Regenerate all committed generated artifacts with:

```bash
pnpm generated:write
```

Regenerate committed capabilities with:

```bash
pnpm docs:capabilities
```
