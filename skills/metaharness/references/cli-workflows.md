# CLI Workflows

Use this reference for `hk` CLI usage, generated config/policy files, artifact
inspection, CI examples, GitHub Action workflows, and terminal-first debugging.

## Table Of Contents

- CLI modes
- Install
- Repository vs consumer workspace
- Global options
- Init
- Doctor
- Run
- Runs and stream
- Ledger
- Resume
- Handoff
- Compare
- Policy
- Docs and generated outputs
- JSON output rules
- GitHub Action workflow
- Troubleshooting checklist

## CLI Modes

Use CLI for:

- initializing a workspace with config and policy files
- running provider tasks from a terminal or CI step
- inspecting `.harness` artifacts
- comparing providers
- handoff across providers
- checking policy
- printing provider capabilities

Use SDK instead when an app needs direct TypeScript objects or embedded event
streams.

## Install

Consumer workspace:

```bash
pnpm add -D @metaharness/cli
```

Add provider SDK peers only for real providers you run:

```bash
pnpm add -D @openai/codex-sdk
pnpm add -D @anthropic-ai/claude-agent-sdk
pnpm add -D @cursor/sdk
```

The CLI package includes the metaharness adapter packages. It does not remove
the need for provider SDK optional peers when running real providers.

Mock-only CLI usage does not require provider SDK peers.

## Repository vs Consumer Workspace

Inside the metaharness repo, build before using root `pnpm hk`:

```bash
pnpm build
pnpm hk --help
```

The root script runs `packages/cli/dist/index.js`.

In a consumer workspace:

```bash
pnpm exec hk --help
```

Do not suggest `hk init` in the metaharness repo root as the quickstart. Use a
separate `--cwd` or run it from the target consumer workspace.

## Global Options

```bash
pnpm exec hk --cwd <path> --config <path> <command>
```

- `--cwd <path>`: workspace root, default current directory.
- `--config <path>`: config path resolved from `--cwd`.

Default config path: `metaharness.config.ts`.

Default policy path: `metaharness.policy.yaml`.

If default config is absent, CLI commands can use a mock-only fallback. If
`--config` is passed, the file must exist.

Supported providers: `mock`, `claude`, `cursor`, `codex`.

## Init

Create config and policy files:

```bash
WORKDIR="$(mktemp -d)"
pnpm exec hk --cwd "$WORKDIR" init --providers mock
```

Create a GitHub Actions workflow:

```bash
pnpm exec hk --cwd "$WORKDIR" init --providers codex --ci github
```

`hk init` creates:

- `metaharness.config.ts`
- `metaharness.policy.yaml`
- `.harness/.gitignore`
- `.github/workflows/metaharness.yml` when `--ci github` is selected

`hk init` refuses to overwrite generated files. Use `--force` only when the user
intentionally wants to regenerate them.

After init:

```bash
pnpm exec hk --cwd "$WORKDIR" doctor --provider mock
pnpm exec hk --cwd "$WORKDIR" run --provider mock --task "Summarize this workspace"
pnpm exec hk --cwd "$WORKDIR" ledger show latest
```

Keep the same `--cwd` for follow-up commands so `latest`, config, policy, and
storage resolve in the same workspace.

When real providers are selected, init output should name:

- provider SDK peer package
- API key env var
- `.harness` sensitivity
- raw-event debugging caveat
- policy allow-list review requirement

## Doctor

Run doctor before live provider work:

```bash
pnpm exec hk doctor --provider mock
pnpm exec hk doctor --provider codex
pnpm --silent exec hk doctor --provider codex --json
```

Use `--all` only when every provider is intentionally configured:

```bash
pnpm exec hk doctor --all
```

Doctor checks:

- Node version
- workspace existence
- package manifest and dependency hints
- config and policy validity
- git state and clean-worktree requirements
- storage writability
- adapter registration
- provider SDK peer installation
- API key presence

Human output should include a `next` section for actionable failures. JSON
output includes structured checks and codes. With `--json`, use `pnpm --silent`
when another command parses stdout.

## Run

Inline task:

```bash
pnpm exec hk run --provider mock --task "Summarize this workspace" --stream
```

Task file:

```bash
pnpm exec hk --cwd "$WORKDIR" run --provider mock --task-file task.md
```

Common options:

- `--provider <provider>`
- `--model <model>`
- `--runtime <local|cloud|self-hosted>`
- `--task <task>`
- `--task-file <path>`
- `--verify <command>` repeatable
- `--stream`
- `--json`
- `--raw-events`

Exactly one of `--task` or `--task-file` is required.

Use verification commands as separate repeatable options:

```bash
pnpm exec hk run \
  --provider codex \
  --runtime local \
  --task "Fix failing tests with a minimal patch" \
  --verify "pnpm test" \
  --verify "pnpm lint" \
  --stream
```

`hk run` exits nonzero with `RUN_RESULT_FAILED` when final status is `failed` or
`cancelled`. With `--json`, stdout is still the `RunResult`.

## Cursor Cloud

Cursor cloud repository flags require `--provider cursor --runtime cloud`:

```bash
pnpm exec hk run \
  --provider cursor \
  --runtime cloud \
  --repo https://github.com/org/repo \
  --starting-ref main \
  --auto-create-pr \
  --task "Fix failing tests"
```

Provider-specific options:

- `--repo <url>`
- `--starting-ref <ref>`
- `--pr-url <url>`
- `--auto-create-pr`
- `--skip-reviewer-request`
- `--work-on-current-branch`

These should fail for non-Cursor providers and non-cloud runtime.

## Runs And Stream

List runs:

```bash
pnpm exec hk runs
pnpm exec hk runs --limit 5
pnpm --silent exec hk runs --json
```

Stream normalized event log:

```bash
pnpm exec hk stream latest
pnpm exec hk stream <run-id>
```

Stream raw events only if captured:

```bash
pnpm exec hk stream <run-id> --raw
```

Use the same `--cwd` and `--config` used for the run when inspecting `latest`.

## Ledger

Human summary:

```bash
pnpm exec hk ledger show latest
```

JSON:

```bash
pnpm --silent exec hk ledger show latest --json
```

Ledger output should show:

- run id
- provider
- status
- workspace
- event log path
- result path
- ledger path
- handoff path
- patch path
- verification log path
- raw-event capture status
- changed files
- verification outcomes

Generate a handoff prompt:

```bash
pnpm exec hk ledger handoff latest
```

## Resume

Native session resume:

```bash
pnpm exec hk resume \
  --provider codex \
  --session <native-session-id> \
  --task "Continue and finish the fix"
```

Resume from a previous run:

```bash
pnpm exec hk resume \
  --run <run-id> \
  --task "Continue from this run and address remaining failures"
```

`--run` uses the previous ledger and its provider unless `--provider` is passed.
This is same-provider resume when native session state is available. It is not
cross-provider hidden-state transfer.

## Handoff

Cross-provider continuation:

```bash
pnpm exec hk handoff \
  --from-run <run-id> \
  --to codex \
  --instruction "Finish the tests" \
  --apply-patch \
  --verify "pnpm test"
```

`--apply-patch` applies the source run patch before starting the target. If the
source has no patch, the command should fail with a typed artifact error.

Handoff uses explicit artifacts, not hidden provider session state.

## Compare

Run the same task across providers:

```bash
pnpm exec hk compare \
  --providers claude,codex \
  --task "Implement the smallest safe fix" \
  --verify "pnpm test" \
  --isolated-worktrees \
  --max-concurrency 1
```

Compare writes:

```text
.harness/compares/<compare-id>/compare.json
.harness/compares/<compare-id>/compare.md
```

It preserves separate provider results. It does not auto-merge output.

## Policy

Check policy:

```bash
pnpm exec hk policy check --policy-file metaharness.policy.yaml --provider codex
```

Compile native hints:

```bash
pnpm --silent exec hk policy compile --provider codex --json
```

Use `policy check` before live runs and `policy compile` when debugging how
provider-native hints and harness guards are derived.

## Docs And Generated Outputs

Render provider capabilities in the repo:

```bash
pnpm docs:capabilities
pnpm hk docs capabilities
pnpm --silent hk docs capabilities --json
```

Generated schema/docs commands in the repo:

```bash
pnpm generated:check
pnpm generated:write
pnpm schemas:generate
```

Do not hand-edit generated capabilities or schemas without running the
corresponding check/generator.

## JSON Output Rules

Use `pnpm --silent` whenever stdout is parsed:

```bash
pnpm --silent exec hk run --provider mock --task "Summarize" --json
```

Do not combine `--json` and `--stream`. JSON output is one machine-readable
document. Streaming output is human-readable event text.

On failure, stderr includes stable error codes such as:

- `CLI_USAGE_ERROR`
- `WORKSPACE_NOT_FOUND`
- `CONFIG_NOT_FOUND`
- `INIT_TARGET_EXISTS`
- `PROVIDER_UNSUPPORTED`
- `TASK_FILE_NOT_FOUND`
- `OUTPUT_MODE_CONFLICT`
- `RUN_ARTIFACT_NOT_FOUND`
- `POLICY_CHECK_FAILED`
- `RUN_RESULT_FAILED`

## GitHub Action Workflow

Generated workflows call `pnpm exec hk`, so target repos need:

- `@metaharness/cli`
- selected provider SDK peers
- provider API keys as GitHub secrets
- minimum required `GITHUB_TOKEN` permissions

Do not put untrusted issue/PR text into inline shell scripts. Pass it as action
inputs or files. Keep raw events disabled for public CI logs unless explicitly
debugging.

## Troubleshooting Checklist

When a CLI command fails:

1. Re-run with `--provider <specific-provider>` instead of `--all`.
2. Run `pnpm --silent exec hk doctor --provider <provider> --json`.
3. Check the active `--cwd`, `--config`, and `storage.rootDir`.
4. Inspect `hk runs`, `hk ledger show <run-id>`, and `hk stream <run-id>`.
5. Check `verification.log` for harness-owned command failures.
6. Check `events.ndjson` for typed `error` events.
7. Enable `--raw-events` only when debugging adapter mapping.
8. Verify optional provider SDK peer and API key env var are present.
