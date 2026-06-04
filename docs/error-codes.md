# Error Codes

metaharness reports stable codes through `HarnessError.code`, CLI stderr
(`error: CODE: ...`), GitHub Action step failures, telemetry setup errors, and
policy diagnostics.

Use this page to identify where a code comes from. Use
[Troubleshooting](troubleshooting.md) when you need a step-by-step fix.

## Core SDK And Artifacts

| Code                          | Appears in          | Meaning or first check                                                                                                 |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ADAPTER_NOT_FOUND`           | Core SDK            | The config names a provider, but `createHarness()` did not receive its adapter.                                        |
| `COMMAND_POLICY_VIOLATION`    | Core SDK            | A provider-observed command matched a deny or approval-required command policy.                                        |
| `COMPARE_INVALID_CONCURRENCY` | Core SDK            | `CompareInput.strategy.maxConcurrency` must be a positive integer.                                                     |
| `COMPARE_NO_PROVIDERS`        | Core SDK            | `CompareInput.providers` is empty or missing.                                                                          |
| `COMPARE_TASK_MISSING`        | Core SDK            | `CompareInput.task` must be a non-empty string.                                                                        |
| `DIRTY_WORKSPACE`             | Core workspace      | `workspace.git.requireClean` is enabled and the Git workspace has uncommitted changes.                                 |
| `EVENT_LOG_INVALID_EVENT`     | Event log reader    | An `events.ndjson` line is JSON, but not a valid portable event.                                                       |
| `EVENT_LOG_INVALID_JSON`      | Event log reader    | An `events.ndjson` line is not valid JSON.                                                                             |
| `EVENT_LOG_READ_ERROR`        | Event log reader    | The event log exists, but could not be read.                                                                           |
| `EVENT_VALIDATION_ERROR`      | Event recorder      | A portable event failed schema or monotonic sequence validation before persistence.                                    |
| `GIT_COMMAND_ERROR`           | Core workspace      | A harness-owned Git command failed; inspect the redacted args and stderr.                                              |
| `GIT_REPOSITORY_REQUIRED`     | Core workspace      | Git-backed options such as `requireClean` or worktrees were requested outside Git.                                     |
| `HANDOFF_PATCH_INVALID`       | Core handoff        | The captured patch cannot be parsed as an applyable handoff patch.                                                     |
| `HANDOFF_PATCH_MISSING`       | Core handoff        | `applyPatch` was requested, but the source run did not capture a patch.                                                |
| `HANDOFF_PATCH_UNSAFE_PATH`   | Core handoff        | A snapshot patch targets an absolute path, parent directory, or empty path.                                            |
| `HANDOFF_PATCH_UNSUPPORTED`   | Core handoff        | The handoff patch contains unsupported content such as binary changes.                                                 |
| `HANDOFF_PROVIDER_MISSING`    | Core SDK and CLI    | Handoff needs a destination provider, such as `toProvider` or `--to`.                                                  |
| `HANDOFF_SOURCE_MISSING`      | Core SDK and CLI    | Handoff needs a source run id, such as `fromRunId` or `--from-run`.                                                    |
| `HARNESS_INPUT_INVALID`       | Core SDK            | Generic input error fallback; most public input paths use a narrower code.                                             |
| `LEDGER_IMPORT_ERROR`         | Core SDK            | A ledger import path could not be read for a reason other than missing file.                                           |
| `LEDGER_IMPORT_INVALID`       | Core SDK            | Imported ledger JSON is invalid or does not match the `SessionLedger` schema.                                          |
| `LEDGER_IMPORT_NOT_FOUND`     | Core SDK            | A ledger import path does not exist.                                                                                   |
| `POLICY_CHECK_ERROR`          | Core policy check   | The policy package threw while checking the configured policy file.                                                    |
| `POLICY_FILE_NOT_FOUND`       | Core policy check   | A configured policy file path does not exist.                                                                          |
| `POLICY_INVALID`              | Core run policy     | Configured run policy parsed, but failed validation before provider work started.                                      |
| `POLICY_PACKAGE_UNAVAILABLE`  | Core policy check   | Policy features require `@metaharness/policy`, or the CLI package that includes it.                                    |
| `PROVIDER_CONFIG_INVALID`     | Provider config     | Generic provider-native config error fallback; adapters usually use a narrower code.                                   |
| `RUN_ARTIFACT_ERROR`          | Run artifact reader | A run `result.json` or `ledger.json` could not be read for an unexpected reason.                                       |
| `RUN_ARTIFACT_INVALID`        | Run artifact reader | A run `result.json` or `ledger.json` is present but not valid JSON.                                                    |
| `RUN_ARTIFACT_NOT_FOUND`      | Run artifact reader | A run artifact is missing; check run id, `latest`, CLI `--cwd`/`--config`, SDK `workspace.cwd`, and `storage.rootDir`. |
| `RUN_HANDLE_UNAVAILABLE`      | Core runtime        | A provider run started without exposing the expected native run handle.                                                |
| `RUN_LIMIT_EXCEEDED`          | Core runtime        | A configured turn, duration, cost, file-count, or diff-byte limit was exceeded.                                        |
| `RUN_RESULT_UNAVAILABLE`      | Core runtime        | The active run result promise is not available yet.                                                                    |
| `RUN_TASK_MISSING`            | Core SDK            | `RunInput.task` must be a non-empty string.                                                                            |
| `UNSUPPORTED_CAPABILITY`      | Core SDK            | Product code called an operation the provider capability matrix marks unsupported.                                     |
| `WORKSPACE_ERROR`             | Core workspace      | Generic workspace failure fallback; inspect the message for the failing operation.                                     |
| `WORKSPACE_SNAPSHOT_ERROR`    | Core workspace      | File snapshot capture failed while reading, listing, or statting the workspace.                                        |

## CLI Codes

CLI commands print typed failures to stderr as `error: CODE: message`.

| Code                           | Appears in               | Meaning or first check                                                                                   |
| ------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `CI_PROVIDER_UNSUPPORTED`      | `hk init`                | `--ci` only supports `github`.                                                                           |
| `CLI_USAGE_ERROR`              | CLI syntax parsing       | Fix the command name, option name, missing option value, or argument shape shown in stderr.              |
| `COMPARE_FAILED`               | `hk compare`             | At least one provider run failed, was cancelled, or failed verification.                                 |
| `CONFIG_IMPORT_ERROR`          | Config loader            | The config file could not be imported as ESM.                                                            |
| `CONFIG_INVALID`               | Config loader            | The imported config does not match the metaharness config schema.                                        |
| `CONFIG_NOT_FOUND`             | Config loader            | An explicit `--config` path does not exist.                                                              |
| `CONFIG_PATH_INVALID`          | Config loader            | The config path points to a directory instead of a file.                                                 |
| `CONFIG_READ_ERROR`            | Config loader            | The config file exists, but could not be read.                                                           |
| `CURSOR_CLOUD_OPTIONS_INVALID` | `hk run`                 | Cursor cloud repository flags require `--provider cursor`, `--runtime cloud`, and required repo context. |
| `DOCTOR_CHECKS_FAILED`         | `hk doctor`              | One or more doctor checks failed; inspect human output or JSON `checks`.                                 |
| `INIT_TARGET_EXISTS`           | `hk init`                | Generated config, policy, harness ignore, or workflow files already exist.                               |
| `NUMERIC_OPTION_INVALID`       | CLI option parsing       | Numeric options such as `--max-concurrency` or `--limit` must be positive integers.                      |
| `OUTPUT_MODE_CONFLICT`         | `hk run`                 | Use either `--json` or `--stream`, not both.                                                             |
| `OUTPUT_PATH_INVALID`          | `hk ledger`              | The requested `--out` path is a directory.                                                               |
| `OUTPUT_PATH_MISSING`          | `hk ledger`              | An output-writing command path needs `--out <file>`.                                                     |
| `OUTPUT_WRITE_ERROR`           | `hk ledger`              | The output file could not be written.                                                                    |
| `POLICY_CHECK_FAILED`          | `hk policy check`        | Policy diagnostics contain at least one error.                                                           |
| `POLICY_VALIDATION_FAILED`     | `hk policy compile`      | Policy could not be parsed or validated before compilation.                                              |
| `PROVIDER_MISSING`             | CLI provider parsing     | A command that needs a provider did not receive one.                                                     |
| `PROVIDER_UNSUPPORTED`         | CLI provider parsing     | Provider id must be `mock`, `claude`, `cursor`, or `codex`.                                              |
| `RESUME_PROVIDER_MISSING`      | `hk resume`              | Resume needs `--provider` or a run ledger that records the provider.                                     |
| `RUN_ID_MISSING`               | Artifact CLI commands    | Pass the required run id, or `latest`, to `hk stream` or `hk ledger` commands.                           |
| `RUN_RESULT_FAILED`            | `hk run` and `hk resume` | The run completed as `failed` or `cancelled`; artifacts are still written.                               |
| `RUNTIME_UNSUPPORTED`          | `hk run`                 | Runtime must be `local`, `cloud`, or `self-hosted`.                                                      |
| `TASK_FILE_NOT_FOUND`          | CLI task loader          | `--task-file` does not exist relative to `--cwd`.                                                        |
| `TASK_FILE_PATH_INVALID`       | CLI task loader          | `--task-file` points to a directory.                                                                     |
| `TASK_FILE_READ_ERROR`         | CLI task loader          | `--task-file` exists, but could not be read.                                                             |
| `TASK_INPUT_CONFLICT`          | CLI task loader          | Use either `--task` or `--task-file`, not both.                                                          |
| `TASK_MISSING`                 | CLI task loader          | A run-like command needs exactly one non-whitespace task source.                                         |
| `WORKSPACE_NOT_DIRECTORY`      | CLI workspace resolver   | `--cwd` points to a file.                                                                                |
| `WORKSPACE_NOT_FOUND`          | CLI workspace resolver   | `--cwd` does not exist.                                                                                  |
| `WORKSPACE_READ_ERROR`         | CLI workspace resolver   | `--cwd` exists, but could not be read.                                                                   |

## GitHub Action Codes

GitHub Action setup failures call `core.setFailed()` with a stable `ACTION_*`
code. The action writes run outputs before failing with `ACTION_RUN_FAILED`.

| Code                                | Meaning or first check                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `ACTION_CONFIG_IMPORT_ERROR`        | The action config file could not be imported as ESM.                                     |
| `ACTION_CONFIG_INVALID`             | The action config does not match the metaharness config schema.                          |
| `ACTION_CONFIG_NOT_FOUND`           | An explicit `config-file` input does not exist.                                          |
| `ACTION_CONFIG_PATH_INVALID`        | `config-file` points to a directory.                                                     |
| `ACTION_CONFIG_READ_ERROR`          | `config-file` exists, but could not be read.                                             |
| `ACTION_GIT_ERROR`                  | A Git command for branch, commit, push, or pull request setup failed.                    |
| `ACTION_POLICY_INVALID`             | The policy file parsed, but failed validation.                                           |
| `ACTION_POLICY_NOT_FOUND`           | An explicit `policy-file` input does not exist.                                          |
| `ACTION_POLICY_PATH_INVALID`        | `policy-file` points to a directory.                                                     |
| `ACTION_POLICY_READ_ERROR`          | `policy-file` exists, but could not be read.                                             |
| `ACTION_PROVIDER_MISSING`           | Required `provider` input is missing.                                                    |
| `ACTION_PROVIDER_UNSUPPORTED`       | Provider or fallback provider must be `mock`, `claude`, `cursor`, or `codex`.            |
| `ACTION_PULL_REQUEST_DIFF_ERROR`    | The action could not determine commit-ready changes outside `.harness`.                  |
| `ACTION_PULL_REQUEST_TARGET_UNSAFE` | The workflow is running on `pull_request_target` without explicit opt-in.                |
| `ACTION_RUN_FAILED`                 | Final provider result was `failed` or `cancelled`; inspect action outputs and artifacts. |
| `ACTION_TASK_FILE_NOT_FOUND`        | `task-file` does not exist relative to the checked-out workspace.                        |
| `ACTION_TASK_FILE_PATH_INVALID`     | `task-file` points to a directory.                                                       |
| `ACTION_TASK_FILE_READ_ERROR`       | `task-file` exists, but could not be read.                                               |
| `ACTION_TASK_INPUT_CONFLICT`        | Use either `task` or `task-file`, not both.                                              |
| `ACTION_TASK_MISSING`               | The action needs exactly one non-whitespace task source.                                 |

## Provider And Telemetry Codes

| Code                                 | Appears in              | Meaning or first check                                                                 |
| ------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------- |
| `CLAUDE_POLICY_INVALID`              | Claude adapter          | Policy passed directly to the adapter could not be mapped to Claude-native options.    |
| `CODEX_SANDBOX_MODE_UNSUPPORTED`     | Codex adapter           | Codex `native.sandbox` or `native.sandboxMode` uses an unsupported sandbox name.       |
| `PROVIDER_CLOSED`                    | Codex app-server client | The app-server client was closed before the request could complete.                    |
| `PROVIDER_PROCESS_EXITED`            | Codex app-server client | The app-server process exited before a valid response arrived.                         |
| `PROVIDER_RPC_ERROR`                 | Codex app-server client | The app-server returned a JSON-RPC error response.                                     |
| `PROVIDER_SDK_MISSING`               | Provider adapters       | Install the optional provider SDK peer for the adapter you are running.                |
| `PROVIDER_TIMEOUT`                   | Codex app-server client | The app-server request exceeded its timeout.                                           |
| `TELEMETRY_CONFIG_INVALID`           | Telemetry package       | Generic telemetry config fallback; most public paths use a narrower code.              |
| `TELEMETRY_EXPORTER_UNSUPPORTED`     | Telemetry package       | Use exporter `none`, `console`, or `otlp`.                                             |
| `TELEMETRY_SETUP_FAILED`             | Telemetry package       | Generic telemetry setup fallback; inspect the message for the failed step.             |
| `TELEMETRY_TRACER_PROVIDER_CONFLICT` | Telemetry package       | Shut down the existing telemetry handle before registering another in-memory provider. |

## Policy Diagnostic Codes

Policy diagnostics are structured results from `@metaharness/policy` and
`hk policy`. They can be errors, warnings, or provider warnings.

| Code                                    | Severity         | Meaning or first check                                                   |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `POLICY_COMMAND_DEFAULT_ALLOW`          | Warning          | `commands.default: allow` makes unlisted commands runnable.              |
| `POLICY_FILE_NOT_FOUND`                 | Error            | The policy file path does not exist.                                     |
| `POLICY_FILE_READ_ERROR`                | Error            | The policy file exists, but could not be read.                           |
| `POLICY_FULL_ACCESS`                    | Warning          | `filesystem.mode: full-access` allows unrestricted writes.               |
| `POLICY_NETWORK_ALLOW`                  | Warning          | `network.mode: allow` disables host allow-list enforcement.              |
| `POLICY_SCHEMA_ERROR`                   | Error            | The parsed policy object does not match the policy schema.               |
| `POLICY_YAML_PARSE_ERROR`               | Error            | YAML parsing failed before schema validation.                            |
| `POLICY_YAML_WARNING`                   | Warning          | The YAML parser reported a non-fatal warning.                            |
| `PROVIDER_POLICY_CLAUDE_NETWORK_LIMITS` | Provider warning | Claude network controls depend on provider-native behavior.              |
| `PROVIDER_POLICY_CODEX_FULL_ACCESS`     | Provider warning | Codex full-access sandbox should require explicit human approval.        |
| `PROVIDER_POLICY_CURSOR_BETA`           | Provider warning | Cursor SDK policy support is beta and runtime-dependent.                 |
| `PROVIDER_POLICY_CURSOR_COMMAND_GUARD`  | Provider warning | Cursor command allow/deny behavior may need harness-level guards.        |
| `PROVIDER_POLICY_MOCK_SYNTHETIC`        | Provider warning | Mock adapter reports policy shape, but does not enforce native controls. |
