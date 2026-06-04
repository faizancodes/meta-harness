# Troubleshooting

Start with the health check that matches where you are:

| Situation                                            | Run first                                              |
| ---------------------------------------------------- | ------------------------------------------------------ |
| Fresh clone, missing build output, or setup drift    | `pnpm setup:doctor`                                    |
| Existing built CLI and one provider to inspect       | `pnpm hk doctor --provider <provider>`                 |
| Automation or issue report that needs parseable data | `pnpm --silent hk doctor --provider <provider> --json` |

`pnpm setup:doctor` runs setup checks, builds packages, then runs the
credential-free mock CLI doctor. Use `hk doctor` after the CLI is built when a
local run, live provider run, or CI workflow does not behave as expected.
Without `--provider`, doctor checks the active config `defaultProvider`, or
`mock` when no config default is set. Check only the provider you are about to
run:

```bash
pnpm hk doctor --provider mock
pnpm hk doctor --provider codex
pnpm --silent hk doctor --provider codex --json
```

Use `pnpm hk doctor --all` only when every provider is intentionally configured.
Otherwise unused providers can report missing package or API key failures.

If you already have a stable code from CLI stderr, JSON, a thrown SDK error, a
GitHub Action failure, or a policy diagnostic, use the compact
[Error codes](error-codes.md) catalog first.

## When This Does Not Resolve It

Use [Support](../SUPPORT.md) to choose the right next path. For reproducible
failures, open the [bug report template](../.github/ISSUE_TEMPLATE/bug_report.md)
with:

- the smallest command, SDK snippet, config shape, or example directory that
  reproduces the issue
- provider id and provider SDK package version, when relevant
- Node and pnpm versions
- the stable error code, redacted stderr, JSON output, or `pnpm setup:doctor`
  result
- the relevant `ProviderCapabilities` flag when behavior differs by provider

Do not paste API keys, tokens, private prompts, private transcripts, raw
provider logs, or sensitive `.harness/` artifacts into public issues. Use
[Security policy](../SECURITY.md) for vulnerabilities or accidental secret
disclosure.

## Local Setup

| Symptom                                      | Fix                                                                                                                                                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm hk` cannot find the CLI file           | Run `pnpm build`; the repo-local `pnpm hk` script executes `packages/cli/dist/index.js`.                                                                                                             |
| `node_modules` is missing                    | Run `pnpm install`. `hk doctor` reports this as a warning until a live provider needs installed SDKs.                                                                                                |
| Node version check fails                     | Use Node 22 or newer. `pnpm setup:check` verifies the active Node process plus `.nvmrc`, `.node-version`, `engines`, and workspace settings.                                                         |
| pnpm version check fails                     | Use pnpm 9.13 or newer. Run `corepack enable` if the expected package-manager version is not available locally.                                                                                      |
| `INIT_TARGET_EXISTS` appears                 | `hk init` found existing generated files. Inspect them, then pass `--force` only when overwriting is intentional.                                                                                    |
| `CI_PROVIDER_UNSUPPORTED` appears            | Use `--ci github` or omit `--ci`.                                                                                                                                                                    |
| `CLI_USAGE_ERROR` appears                    | Fix the command syntax shown after the code; use `pnpm hk --help` or `pnpm hk <command> --help` to inspect valid commands and options.                                                               |
| `WORKSPACE_NOT_FOUND` appears                | Create the workspace directory first or pass `--cwd <existing-directory>`.                                                                                                                           |
| `WORKSPACE_NOT_DIRECTORY` appears            | Pass `--cwd <existing-directory>` instead of a file path.                                                                                                                                            |
| `PROVIDER_UNSUPPORTED` appears               | Use one of the supported provider ids: `mock`, `claude`, `cursor`, or `codex`.                                                                                                                       |
| `PROVIDER_MISSING` appears                   | Pass at least one provider id, for example `--provider mock` or `--providers mock,codex`.                                                                                                            |
| `CONFIG_NOT_FOUND` appears                   | Fix the explicit `--config` path or omit `--config` to use `metaharness.config.ts`; `--config` is resolved relative to `--cwd`.                                                                      |
| `CONFIG_PATH_INVALID` appears                | Pass `--config <file>` instead of a directory, or omit `--config` to use `metaharness.config.ts`.                                                                                                    |
| `CONFIG_IMPORT_ERROR` appears                | Keep `metaharness.config.ts` as plain ESM. Avoid runtime imports unless the package is installed in the target workspace.                                                                            |
| `CONFIG_INVALID` appears                     | Fix the reported config diagnostics; provider ids, provider entries, and enum values must match the config schema.                                                                                   |
| `TASK_MISSING` appears                       | Pass exactly one non-whitespace task source: `--task <text>` or `--task-file <file>`.                                                                                                                |
| `RUN_TASK_MISSING` appears                   | SDK callers must pass a non-empty `RunInput.task`; CLI users should pass `--task <text>` or `--task-file <file>`.                                                                                    |
| `COMPARE_TASK_MISSING` appears               | SDK callers must pass a non-empty `CompareInput.task`; CLI users should pass `--task <text>` or `--task-file <file>`.                                                                                |
| `COMPARE_NO_PROVIDERS` appears               | SDK callers must pass at least one `CompareInput.providers` entry; CLI users should pass `--providers mock,codex`.                                                                                   |
| `CODEX_SANDBOX_MODE_UNSUPPORTED` appears     | Use `read-only`, `workspace-write`, `full-access`, or `danger-full-access` for Codex `native.sandbox` or `native.sandboxMode`.                                                                       |
| `CLAUDE_POLICY_INVALID` appears              | Fix the policy passed directly to the Claude adapter; normal harness runs report invalid run policy earlier as `POLICY_INVALID`.                                                                     |
| `TELEMETRY_EXPORTER_UNSUPPORTED` appears     | Use `none`, `console`, or `otlp` for `telemetry.exporter`, `METAHARNESS_OTEL_EXPORTER`, or `metaharness_OTEL_EXPORTER`. If both env vars are set, the `metaharness_OTEL_*` alias wins.               |
| `TELEMETRY_TRACER_PROVIDER_CONFLICT` appears | Call `shutdown()` on the existing telemetry handle before starting another in-memory telemetry provider in the same process.                                                                         |
| `TASK_INPUT_CONFLICT` appears                | Use either `--task` or `--task-file`, not both.                                                                                                                                                      |
| `TASK_FILE_NOT_FOUND` appears                | Fix the `--task-file` path; it is resolved relative to `--cwd`.                                                                                                                                      |
| `TASK_FILE_PATH_INVALID` appears             | Pass `--task-file <file>` instead of a directory.                                                                                                                                                    |
| `OUTPUT_MODE_CONFLICT` appears               | Use either `--json` or `--stream`, not both.                                                                                                                                                         |
| `RUNTIME_UNSUPPORTED` appears                | Use `--runtime local`, `--runtime cloud`, or `--runtime self-hosted`.                                                                                                                                |
| `CURSOR_CLOUD_OPTIONS_INVALID` appears       | Cursor cloud repository flags require `--provider cursor`, `--runtime cloud`, and `--repo` when `--starting-ref` or `--pr-url` is set.                                                               |
| `NUMERIC_OPTION_INVALID` appears             | Pass a positive integer for numeric CLI options such as `--max-concurrency` or `--limit`.                                                                                                            |
| `HANDOFF_SOURCE_MISSING` appears             | Pass `--from-run <run-id>` to choose the source run for handoff.                                                                                                                                     |
| `HANDOFF_PROVIDER_MISSING` appears           | Pass `--to <provider>` to choose the destination provider for handoff.                                                                                                                               |
| `RESUME_PROVIDER_MISSING` appears            | Pass `--provider <provider>` or `--run <run-id>` with a ledger that records the provider.                                                                                                            |
| Policy validation fails                      | Run `pnpm hk policy check --policy-file metaharness.policy.yaml --provider <provider>` and fix the reported diagnostics.                                                                             |
| `POLICY_CHECK_FAILED` appears                | Inspect the policy diagnostics printed on stdout or stderr; individual diagnostics include more specific `POLICY_*` or `PROVIDER_POLICY_*` codes.                                                    |
| `POLICY_VALIDATION_FAILED` appears           | Fix the policy file before compiling provider-native policy; `policy compile --json` still prints the diagnostics to stdout.                                                                         |
| Workspace is not a git repository            | This is a warning unless `workspace.git.requireClean` is enabled. Run from a git workspace for diff capture and compare worktrees.                                                                   |
| `WORKSPACE_SNAPSHOT_ERROR` appears           | Fix permissions on the reported path, remove unreadable generated files, or run from a Git workspace where ignored files stay out of capture.                                                        |
| `.harness` is not writable                   | Fix storage permissions or set another `storage.rootDir` in config.                                                                                                                                  |
| Live provider gate is ignored                | Set the gate environment variable to exactly `1`. Values like `true` are ignored and reported by `pnpm test:live` before Vitest starts.                                                              |
| `RUN_RESULT_FAILED` appears                  | Inspect stdout or `.harness/runs/<run-id>/result.json`; failed verification, provider failure, cancellation, limits, and policy can fail a run.                                                      |
| `COMPARE_FAILED` appears                     | Use the compare table or `.harness/compares/<compare-id>/compare.md` to choose a run id, then run `pnpm hk ledger show <run-id>` and `pnpm hk stream <run-id>`. Parse `compare.json` for automation. |
| `DOCTOR_CHECKS_FAILED` appears               | Inspect the doctor output, especially the `next` section or JSON checks with status `warn` or `fail`; checks include a `code` when a typed diagnostic is available.                                  |
| `RUN_ID_MISSING` appears                     | Pass a run id, or `latest` for the most recent run, to `hk stream <run-id\|latest>` or `hk ledger <show\|export\|handoff> <run-id\|latest>`.                                                         |
| Run artifacts are not found                  | Check the run id, `--cwd`, `--config`, and `storage.rootDir`; artifacts are read from `.harness/runs/<run-id>/` by default.                                                                          |
| `OUTPUT_PATH_MISSING` appears                | Pass `--out <file>` when using an output-writing command path.                                                                                                                                       |
| `OUTPUT_PATH_INVALID` appears                | Pass `--out <file>`, not a directory.                                                                                                                                                                |
| `OUTPUT_WRITE_ERROR` appears                 | Fix permissions or choose another `--out` path.                                                                                                                                                      |
| JSON output contains a pnpm banner           | Use `pnpm --silent hk ... --json` when another command parses stdout.                                                                                                                                |
| JSON command exits nonzero                   | Parse stdout for the report, then use stderr for the concise CLI failure message.                                                                                                                    |
| `--json` and `--stream` are both used        | Pick one. JSON output is a single machine-readable document; streaming output is human-readable event text.                                                                                          |

## GitHub Action

GitHub Action setup failures start with stable `ACTION_*` codes in the failed
step message.

| Symptom                                     | Fix                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ACTION_PROVIDER_MISSING` appears           | Set the required `provider` input to `mock`, `claude`, `cursor`, or `codex`.                                                                       |
| `ACTION_PROVIDER_UNSUPPORTED` appears       | Fix the `provider` or `fallback-provider` input; `openai` is not a provider id.                                                                    |
| `ACTION_TASK_MISSING` appears               | Pass exactly one non-whitespace task source: `task` or `task-file`.                                                                                |
| `ACTION_TASK_INPUT_CONFLICT` appears        | Use either `task` or `task-file`, not both.                                                                                                        |
| `ACTION_TASK_FILE_NOT_FOUND` appears        | Fix `task-file`; it is resolved relative to the checked-out workspace.                                                                             |
| `ACTION_CONFIG_NOT_FOUND` appears           | Fix explicit `config-file`, or omit it to use the default action config.                                                                           |
| `ACTION_CONFIG_IMPORT_ERROR` appears        | Keep the config as plain ESM and install any packages it imports in the checked-out workspace.                                                     |
| `ACTION_CONFIG_INVALID` appears             | Fix the reported schema diagnostics in `metaharness.config.ts`; provider keys and provider values must match.                                      |
| `ACTION_POLICY_NOT_FOUND` appears           | Fix explicit `policy-file`, or omit it to use provider defaults.                                                                                   |
| `ACTION_POLICY_INVALID` appears             | Fix the policy diagnostics printed after the failure message.                                                                                      |
| `ACTION_PULL_REQUEST_TARGET_UNSAFE` appears | Use a safer event, or set `allow-pull-request-target: true` only after explicit trust checks.                                                      |
| `ACTION_PULL_REQUEST_DIFF_ERROR` appears    | Inspect the Git error in the failed step; the action could not determine whether commit-ready workspace changes exist outside `.harness`.          |
| `ACTION_GIT_ERROR` appears                  | Inspect the redacted Git command and stderr in the failed step; check checkout permissions, branch protection, remotes, and `github-token`.        |
| `ACTION_RUN_FAILED` appears                 | Inspect action outputs such as `run-id`, `status`, `ledger-file`, `handoff-file`, and `patch-file`; outputs are written before the step is failed. |

## Provider Setup

Provider SDKs are optional peers. For SDK usage, install `@metaharness/core`,
the adapter packages you use, and only the SDK peers for providers you actually
run:

```bash
pnpm add @metaharness/core @metaharness/codex
pnpm add -D @openai/codex-sdk
```

For CLI or generated GitHub workflow usage, install `@metaharness/cli`; it
includes the metaharness adapter packages. Add only the provider SDK optional
peers used by real-provider runs:

```bash
pnpm add -D @metaharness/cli @openai/codex-sdk
```

For mock-only CLI usage, omit provider SDKs.

Provider defaults:

| Provider | Adapter package       | SDK package                      | API key env         |
| -------- | --------------------- | -------------------------------- | ------------------- |
| Claude   | `@metaharness/claude` | `@anthropic-ai/claude-agent-sdk` | `ANTHROPIC_API_KEY` |
| Cursor   | `@metaharness/cursor` | `@cursor/sdk`                    | `CURSOR_API_KEY`    |
| Codex    | `@metaharness/codex`  | `@openai/codex-sdk`              | `OPENAI_API_KEY`    |

If `hk doctor --provider <provider>` reports `provider SDK package installed`
as a failure, install that SDK peer in the workspace where the CLI is running.
If it reports `<provider> adapter registered` as a failure, install and register
the metaharness adapter package. If it reports `api key present` as a failure,
set the provider API key env var or configure `providers.<provider>.apiKeyEnv`.

Do not treat provider behavior as interchangeable. Read
[Provider capabilities](provider-capabilities.md) before exposing cancellation,
cloud runtime, artifact, pull request, or handoff controls in product code.

## Artifacts And Output

Runs write under `.harness/runs/<run-id>/` by default:

```text
events.ndjson
result.json
ledger.json
handoff.md
diff.patch
verification.log
provider/raw-events.ndjson
```

Raw provider events are disabled by default. `provider/raw-events.ndjson` exists
only when raw capture is explicitly enabled with config, SDK input, or CLI
`--raw-events`. Keep raw capture for trusted debugging, not normal CI.

If `hk stream`, `hk resume --run`, `hk handoff --from-run`, `hk ledger show`,
`hk ledger export`, or `hk ledger handoff` reports `RUN_ARTIFACT_NOT_FOUND`,
verify the run id and the workspace options used for the original run. `--cwd`,
`--config`, and `storage.rootDir` all affect where artifacts are read from. If
you passed `latest`, start a run first or verify that the command is using the
workspace and storage root where prior runs were written. If it reports
`RUN_ARTIFACT_INVALID`, remove or rename the conflicting path under the
configured artifact directory.

If `hk stream` reports `EVENT_LOG_INVALID_JSON` or `EVENT_LOG_INVALID_EVENT`,
inspect the reported log path and line number. The event log is JSONL; each
non-empty line must be valid JSON matching the portable event schema.

Compare writes reports under `.harness/compares/<compare-id>/`:

```text
compare.json
compare.md
```

Human `hk compare` output and `compare.md` include a run id for each provider
result. Use that run id to inspect the selected provider result:

```bash
pnpm hk ledger show <run-id>
pnpm hk stream <run-id>
```

Use `compare.json` when automation needs the full machine-readable comparison.

Treat `.harness/` as sensitive. It can contain prompts, transcripts, command
summaries, patches, verification output, and provider metadata even when secret
redaction is enabled.

## Validation Drift

Use the narrow command first, then run the broader gate before publishing or
handoff:

| Failure                                          | First command to run                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Repository setup or ignore files drift           | `pnpm setup:check`                                                            |
| Fresh clone doctor fails                         | `pnpm setup:doctor`                                                           |
| ESLint fails                                     | `pnpm lint`                                                                   |
| TypeScript package checks fail                   | `pnpm typecheck`                                                              |
| Test suite or conformance fails                  | `pnpm test`                                                                   |
| Formatting check fails                           | `pnpm format:write`, or `pnpm format:write <path>`, then `pnpm format`        |
| Generated docs and schemas drift                 | `pnpm generated:write`                                                        |
| Local `.harness` artifacts accumulate            | `pnpm artifacts:clean -- --dry-run`, then `pnpm artifacts:clean -- --yes`     |
| Ignored local outputs accumulate                 | `pnpm clean -- --dry-run`, then `pnpm clean -- --yes`                         |
| Generated capability docs drift                  | `pnpm docs:capabilities`                                                      |
| Generated JSON Schema drift                      | `pnpm schemas:generate`                                                       |
| CLI help output drift                            | `pnpm cli:help:check`                                                         |
| Documentation aggregate fails                    | `pnpm docs:check`                                                             |
| CLI reference docs drift                         | `pnpm docs:cli:check`                                                         |
| Validation guidance drifts                       | `pnpm docs:validation:check`                                                  |
| Markdown links, docs index, or package maps fail | `pnpm docs:links:check`                                                       |
| Verified source docs drift                       | `pnpm docs:sources:check`                                                     |
| Error code docs drift                            | `pnpm docs:error-codes:check`                                                 |
| Policy docs/examples fail                        | `pnpm docs:policy:check`                                                      |
| TypeScript docs/examples fail                    | `pnpm docs:snippets:check`                                                    |
| Example docs drift                               | `pnpm examples:docs:check`                                                    |
| Credential-free example smoke fails              | `pnpm examples:smoke`                                                         |
| Package tarball contents fail                    | `pnpm package:check`                                                          |
| Consumer install smoke fails                     | `pnpm consumer:smoke`                                                         |
| Release workflow check fails                     | `pnpm release:check`                                                          |
| Unknown local validation issue                   | `pnpm check`, then `pnpm ci:check` before broad changes, releases, or handoff |

`pnpm generated:check` compares committed generated docs and schemas without
rewriting files. Use it to confirm generated artifacts are in sync after running
`pnpm generated:write` or the narrower generation commands above.

## GitHub Actions

For generated or hand-written workflows:

- Install `@metaharness/cli`; it includes the metaharness adapter packages.
- Install the provider SDK optional peers used by real-provider workflow runs.
- Prefer generated `pnpm exec hk` workflows for provider-backed runs. Installing
  provider SDK peers in the target checkout satisfies the CLI workflow, not an
  external pinned JavaScript action's peer resolution.
- Pass provider keys through repository secrets and `env`.
- Grant `contents: write` and `pull-requests: write` only when
  `open-pull-request` is enabled.
- Avoid `pull_request_target` for provider-backed agent workflows unless the
  workflow performs explicit trust checks before invoking metaharness.
- Upload `.harness/runs` with `if: always()` when you need ledgers, patches,
  handoff prompts, verification logs, or raw event files after the job ends,
  including failed runs.

See [GitHub Action](github-action.md) and
[examples/github-action](../examples/github-action) for the action inputs and a
conservative issue-labeled workflow.

## Known Provider Caveats

- Cursor local cancellation is intentionally treated as unsupported for
  `@cursor/sdk@1.0.17` until live conformance proves the installed SDK version is
  process-clean.
- Handoff is explicit context transfer through ledgers, handoff prompts, patches,
  and verification output. It does not move hidden provider-native session state
  between providers.
- Policy is defense in depth. It combines provider-native hints with observable
  harness guards and should not be treated as a complete sandbox boundary.
