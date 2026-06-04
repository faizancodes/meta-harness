# Session Ledger

`SessionLedger` is the portable state artifact for a run. It is designed for
handoff, comparison, audit, and replay-by-summary. It is not a provider-native
session file.

## Schema

Current schema version: `metaharness.session-ledger.v1`.

| Field          | Contents                                                                |
| -------------- | ----------------------------------------------------------------------- |
| `task`         | Original prompt, normalized prompt if available, mode, desired output.  |
| `provider`     | Provider id, model, runtime, native session/run ids, native URL.        |
| `workspace`    | cwd, repo refs/commits/branch, dirty state before and after.            |
| `events`       | Event log paths and counts by portable event type.                      |
| `transcript`   | User prompt and completed assistant messages with timestamps.           |
| `plans`        | Captured plan snapshots.                                                |
| `tools`        | Completed tool calls with summaries.                                    |
| `commands`     | Completed commands with cwd, exit code, and summary.                    |
| `files`        | Files read when known, file changes when provider/core exposes them.    |
| `verification` | Verification commands, exit codes, output path, summaries.              |
| `artifacts`    | Patches, branches, PRs, files, URLs, or unknown artifacts.              |
| `diff`         | Patch path, unified diff, and stats from Git or text snapshot fallback. |
| `usage`        | Token, cache-token, and estimated cost data when exposed.               |
| `summary`      | Final message, facts, open questions, next steps, failure reason.       |
| `handoffFrom`  | Source ledger/provider/run metadata for handoff runs.                   |

## Generation

Core builds the ledger after `adapter.wait()` completes and after verification and
workspace diff capture. The ledger is redacted before it is written.

The ledger combines:

- normalized events from `events.ndjson`
- provider `RunResult`
- workspace snapshots before and after the run
- Git diff/numstat or non-Git text snapshot fallback
- verification command output
- explicit handoff metadata

`files.changed` prefers provider-emitted file-change events when available. If a
provider only exposes a final workspace diff, core derives missing changed-file
entries from the captured Git patch or metaharness text snapshot patch. Provider
artifact results and `artifact.created` events are both preserved in
`artifacts`.

## Storage

Each run writes:

```text
.harness/runs/<run-id>/ledger.json
.harness/runs/<run-id>/verification.log
```

`verification.log` is created for every run. When no verification commands are
configured, it contains a short placeholder line so artifact consumers can rely on
the path from `RunResult.verificationLogPath`.

Use `hk runs` to list recent run ids. Use `hk ledger show <run-id>` for a human
run summary with artifact paths, changed files, verification outcomes, and event
counts. Use `latest` in place of `<run-id>` for the most recent run under the
active workspace and storage root. Use `harness.exportLedger(runId)` or
`hk ledger show <run-id> --json` when automation needs the full ledger object.
Use `hk ledger handoff <run-id>` to render the handoff markdown from it.

## Portability Limit

Native Claude, Cursor, and Codex session state can contain provider-private
conversation, tool, checkpoint, or runtime data. The ledger captures explicit
portable context only. It is suitable for handoff and audit, but it does not make
hidden provider state portable.
