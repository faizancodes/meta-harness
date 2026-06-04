# Security

metaharness assumes coding agents can read, write, run commands, and call tools.
The security model is therefore defense in depth: provider-native controls,
harness-level policy, redaction, append-only audit logs, and explicit CI hygiene.

## Authentication Boundary

Adapters use official provider SDK packages where available:

- Claude: `@anthropic-ai/claude-agent-sdk`
- Cursor: `@cursor/sdk`
- Codex: `@openai/codex-sdk`

Provider SDKs are optional peer dependencies and are loaded with dynamic imports.
metaharness does not reverse-engineer provider auth, proxy subscription logins, or
use consumer subscription flows. Configure API keys with provider-supported
environment variables such as `ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, and
`OPENAI_API_KEY`.

## Redaction

Normalized event logs, raw provider logs, `result.json`, `ledger.json`,
`handoff.md`, and compare summaries pass through redaction unless
`storage.redactSecrets: false` is set.

Redaction covers:

- keys matching `apiKey`, `authorization`, `credential`, `password`, `secret`, or
  `token`
- secret-looking values from environment variables with sensitive names
- default token patterns for OpenAI, GitHub PATs, and Slack tokens
- provider raw events when raw storage is explicitly enabled

`diff.patch` remains an applyable patch artifact and is not rewritten by the
run-store redaction layer. Treat captured patches as sensitive when the diff may
contain credentials or private data.

GitHub Action code also registers known input secrets with `@actions/core`
`setSecret`, so CI logs receive runner-level masking in addition to metaharness
redaction.

## Raw Provider Events

`provider.raw` events are never written to `events.ndjson`. They are dropped unless
`rawEvents` is enabled. When enabled, they are written to
`provider/raw-events.ndjson` after the same redaction pass.

Keep raw events disabled for normal CI. Enable them only for adapter debugging
with config `rawEvents: true`, `RunInput.rawEvents`, or CLI `--raw-events`, then
treat the raw log as sensitive.

## Commands

Core git operations use `execFile("git", args, { shell: false })`.

Verification commands are parsed into argv and run with `execFile` with
`shell: false`. Shell operators such as pipes, redirects, command substitution,
`&&`, `||`, and `;` are rejected. This keeps verification commands direct and
auditable.

Provider-executed commands remain provider-native. Policy compilation forwards
provider-native controls where available. When a provider exposes command events,
metaharness also evaluates the observed command against the compiled command
policy. A denied or approval-required observed command fails the harness result
with a `COMMAND_POLICY_VIOLATION` audit event.

## Policy

Policy defaults are conservative:

- filesystem: `workspace-write`, with common secret and dependency paths denied
- network: `deny-by-default`
- commands: default deny, with explicit allow/deny lists
- approvals: configurable human approval reasons
- limits: turns, duration, cost, changed files, and diff bytes

Provider warnings document where provider-native enforcement is incomplete or
runtime-dependent. Do not treat a warning-free compile as a sandbox guarantee.

Core also checks observable command policy and run limits for completed assistant
messages, duration, estimated cost, changed-file count, and diff byte size before
writing `result.json` and `ledger.json`. Exceeded limits become a failed harness
result with a `RUN_LIMIT_EXCEEDED` event. `maxTurns` is counted from portable
`assistant.message.completed` events; provider-native turn limits may still be
forwarded where SDKs expose them.

## CI

For GitHub Actions:

- pass untrusted issue/PR content as action inputs, not inline shell scripts
- grant the minimum needed `GITHUB_TOKEN` permissions
- avoid enabling raw provider events in public logs
- keep `.harness/` out of commits unless a specific artifact is intentionally
  uploaded
- prefer verification commands that run test binaries directly

GitHub documents script injection risks in workflow contexts and notes that
automatic secret redaction is not guaranteed for transformed values. metaharness
therefore redacts before writing artifacts and uses action-level secret masking
for configured tokens.
