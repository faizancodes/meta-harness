# Event Model

`PortableRunEvent` is the normalized stream emitted by adapters and persisted by
core. It is intentionally operational: enough to audit lifecycle, text streaming,
plans, tools, commands, file changes, diffs, approvals, usage, artifacts, errors,
and completion.

## Base Shape

Every event has:

- `id`
- `ts`
- `provider`
- `runId`
- `sessionId`
- `seq`
- `type`
- optional `severity`

`seq` must be positive and monotonic within a run. `FileEventRecorder` validates
events before appending them to NDJSON.

## Portable Types

| Type                          | Meaning                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `run.started`                 | Run accepted by the adapter.                                   |
| `run.status`                  | Provider or harness lifecycle status update.                   |
| `assistant.message.delta`     | Streamed assistant text.                                       |
| `assistant.message.completed` | Completed assistant message.                                   |
| `plan.updated`                | Current provider-visible plan.                                 |
| `tool.started`                | Tool call began.                                               |
| `tool.delta`                  | Tool call streamed text or structured data.                    |
| `tool.finished`               | Tool call completed or failed.                                 |
| `command.started`             | Command execution began.                                       |
| `command.output.delta`        | Command stdout/stderr/combined output.                         |
| `command.finished`            | Command execution completed or failed.                         |
| `file.change.started`         | File change began.                                             |
| `file.change.updated`         | File change diff/progress update.                              |
| `file.change.finished`        | File change completed, failed, or was declined.                |
| `diff.updated`                | Unified diff for the run changed.                              |
| `approval.requested`          | Provider or harness requests a human/security decision.        |
| `approval.resolved`           | Approval decision was recorded.                                |
| `usage.updated`               | Token/cost usage update.                                       |
| `artifact.created`            | Patch, branch, PR, file, screenshot, URL, or unknown artifact. |
| `error`                       | Normalized error event.                                        |
| `run.completed`               | Terminal run status and optional result summary.               |
| `provider.raw`                | Provider-native event, gated and stored separately.            |

Provider adapters may emit their own `run.completed`. Core may append a later
harness-level `run.completed` when an observable guard, such as a run limit, changes
the portable outcome after provider completion. Consumers that need the final
metaharness outcome should read `result.json` or the last `run.completed` event.

## Provider Raw Events

Adapters may emit `provider.raw` for diagnostics. Core does not put those events in
the portable event log. If `rawEvents` is false, raw events are dropped. If true,
raw events are redacted and written to `provider/raw-events.ndjson`.

Use `RunInput.rawEvents`, config-level `rawEvents: true`, or CLI
`pnpm hk run --raw-events` / `pnpm hk resume --raw-events` to capture raw events
for a run. Use `pnpm hk stream <run-id> --raw` to print the raw provider log
after capture. Use `pnpm hk stream latest` for the most recent portable event log
under the active workspace and storage root.

Application code should consume portable types first and treat raw events as an
adapter-debugging escape hatch.

## Mapping Expectations

Adapters map provider-native event names defensively:

- Claude tool/result messages map to tool, command, usage, assistant, and raw
  events where exposed.
- Cursor run events map to assistant, tool, task/plan, artifact, approval, result,
  and raw events where exposed.
- Codex SDK mode maps thread/turn results and item-like events.
- Codex app-server mode maps rich v2 notifications, including plan, diff, usage,
  command, file change, MCP, dynamic tool, web search, approval, and raw events.

Unsupported event detail should be absent or represented as `unknown`; adapters
must not invent fidelity that the provider did not expose.
