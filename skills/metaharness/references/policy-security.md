# Policy And Security

Use this reference for policy YAML, provider-native permission hints, command
checks, redaction, raw events, verification commands, authentication, CI safety,
and `.harness` artifact handling.

## Table Of Contents

- Security boundary
- Authentication
- Default policy shape
- Policy sections
- Policy compilation
- Command checks
- Run limits
- Redaction
- Raw events
- Verification commands
- Artifact handling
- CI and GitHub Actions
- Documentation rules

## Security Boundary

Assume coding agents can read files, write files, run commands, call tools, and
emit sensitive text.

metaharness provides defense in depth:

- official SDK authentication
- provider-native permission and sandbox hints
- portable policy parsing and validation
- provider-specific policy compilation warnings
- observable command checks
- observable run limits
- append-only event logs
- secret redaction
- explicit ledgers, diffs, handoff prompts, and verification logs

Policy is not a complete sandbox. Provider-native enforcement differs by
provider/runtime, and limitations must remain visible.

## Authentication

Use provider-supported API key env vars:

| Provider     | Env var             |
| ------------ | ------------------- |
| Claude       | `ANTHROPIC_API_KEY` |
| Cursor       | `CURSOR_API_KEY`    |
| Codex/OpenAI | `OPENAI_API_KEY`    |

Use `apiKeyEnv` in provider config when examples need to name a key:

```ts
providers: {
  codex: {
    provider: "codex",
    apiKeyEnv: "OPENAI_API_KEY"
  }
}
```

Never:

- print API keys
- store keys in examples
- commit `.env`
- reverse-engineer provider auth
- proxy consumer subscription login
- use provider login flows that are not supported by the official SDK

## Default Policy Shape

`hk init` writes a policy like:

```yaml
version: 1
filesystem:
  mode: workspace-write
  writableRoots:
    - "."
  deny:
    - ".env"
    - ".env.local"
    - ".env.*.local"
    - ".env.development"
    - ".env.production"
    - ".env.test"
    - ".env.staging"
    - "**/id_rsa"
    - "**/.aws/**"
    - "**/.ssh/**"
    - "**/node_modules/**"
network:
  mode: deny-by-default
  allowHosts:
    - "registry.npmjs.org"
commands:
  default: deny
  allow:
    - "pnpm test"
    - "pnpm lint"
    - "git diff"
    - "git diff *"
    - "git status"
    - "mock verify"
  deny:
    - "rm -rf *"
    - "curl * | sh"
    - "wget * | sh"
    - "printenv"
    - "env"
approvals:
  requireHumanFor:
    - outsideWorkspaceWrite
    - destructiveCommand
    - network
    - secretsAccess
secrets:
  redactEnv:
    - "OPENAI_API_KEY"
    - "ANTHROPIC_API_KEY"
    - "CURSOR_API_KEY"
    - "GITHUB_TOKEN"
  redactPatterns:
    - "sk-[A-Za-z0-9_-]{20,}"
    - "ghp_[A-Za-z0-9_]{20,}"
limits:
  maxTurns: 30
  maxDurationMs: 1800000
  maxFilesChanged: 25
  maxDiffBytes: 500000
providerOverrides: {}
```

Add project-specific secret file names to `filesystem.deny`. Keep
`.env.example` available for placeholder documentation.

## Policy Sections

- `filesystem`: mode, writable roots, denied paths.
- `network`: allow, deny-by-default, provider-default, allowed hosts.
- `commands`: default allow/deny plus allow and deny patterns.
- `approvals`: reasons requiring human approval.
- `secrets`: env names and regexes for redaction.
- `limits`: turns, duration, cost, changed file count, diff byte count.
- `providerOverrides`: provider-specific escape hatch merged into native hints.

Filesystem modes:

- `read-only`: provider should not write workspace files.
- `workspace-write`: provider may write configured workspace roots.
- `full-access`: high-risk, only for explicitly trusted workflows.

Network modes:

- `deny-by-default`: allow only configured hosts where provider supports hints.
- `allow`: provider may access network.
- `provider-default`: preserve provider default behavior.

## Policy Compilation

`compileProviderPolicy(provider, policy)` returns:

- `nativeConfig`: provider-native hints where mapping exists.
- `harnessGuards`: portable guards metaharness can enforce or audit.
- `warnings`: provider/runtime limitations and incomplete enforcement notes.

Examples:

- Claude maps filesystem mode into permission/tool hints.
- Cursor maps local sandbox options and emits runtime warnings where needed.
- Codex maps filesystem mode into sandbox mode and forwards approval/network
  hints where supported.

Core validates policy before provider sessions start and forwards compiled
native hints into session/run options. Native overrides remain available but
must be explicit.

## Command Checks

metaharness evaluates observable provider command events. If a provider emits
`command.started` or `command.finished` and the compiled policy denies or
requires approval for that command, core should:

- mark the harness result `failed`
- append a `COMMAND_POLICY_VIOLATION` error event
- preserve the original command event for auditability
- still write terminal result and ledger artifacts

Do not assume providers will attempt denied commands. A compliant provider may
avoid the command and finish successfully.

## Run Limits

Core enforces observable limits after provider completion, verification, and
diff capture:

- `maxDurationMs`: elapsed harness time.
- `maxTurns`: count of portable assistant completion events.
- `maxCostUsd`: result usage or latest usage event with estimated cost.
- `maxFilesChanged`: workspace diff, file events, and patch headers.
- `maxDiffBytes`: captured unified diff byte length.

Exceeded limits produce:

- failed `RunResult`
- `RUN_LIMIT_EXCEEDED` error event
- final `run.completed`

Native provider completion remains in logs for auditability.

## Redaction

Redaction applies to normalized logs, raw logs, result JSON, ledger JSON,
handoff markdown, and compare summaries unless `storage.redactSecrets: false`.

Redaction covers:

- keys like `apiKey`, `authorization`, `credential`, `password`, `secret`,
  `token`
- configured secret env values
- common token-looking patterns such as OpenAI keys, GitHub PATs, Slack tokens
- raw provider events when raw capture is enabled

Important: `diff.patch` is not rewritten by the run-store redaction layer
because it must remain applyable. Treat patches as sensitive.

## Raw Events

Raw provider events are disabled by default. Enable only for adapter debugging:

- config: `rawEvents: true`
- run input: `rawEvents: true`
- CLI: `--raw-events`

Raw events go to:

```text
.harness/runs/<run-id>/provider/raw-events.ndjson
```

Normalized events go to:

```text
.harness/runs/<run-id>/events.ndjson
```

Do not build normal product behavior on raw events.

## Verification Commands

Harness-owned verification commands should be direct commands:

```ts
verification: ["pnpm test", "pnpm lint"];
```

Core parses and runs verification with `execFile` and `shell: false`.

Rejected shell behavior includes:

- pipes
- redirects
- command substitution
- `&&`
- `||`
- `;`

Avoid:

```ts
verification: ["pnpm test && pnpm lint"];
verification: ["cat package.json | jq .name"];
```

Harness-owned git and verification commands should use argv arrays internally,
not shell string interpolation.

## Artifact Handling

`.harness/` can contain:

- prompts and task text
- transcripts
- command summaries
- diffs
- raw provider metadata
- verification output
- handoff prompts

Keep `.harness/` ignored by default. Do not upload it to public CI logs unless
the user intentionally chooses an artifact policy and accepts the sensitivity.

When sharing evidence, prefer concise redacted snippets and file paths.

## CI And GitHub Actions

For public CI:

- pass untrusted issue or PR text as action inputs or files, not inline shell
  scripts
- use minimum `GITHUB_TOKEN` permissions
- store provider keys in repository secrets
- keep raw provider events disabled
- mask known secrets at the CI platform level too
- do not commit `.harness/` artifacts
- do not run live provider tests unless gates and credentials are explicitly set

Generated GitHub workflows call `pnpm exec hk`; target repos must install
`@metaharness/cli` and selected provider SDK peers.

## Documentation Rules

When writing docs or examples:

- Say policy is defense in depth, not a formal sandbox guarantee.
- Name provider warnings honestly.
- Keep auth examples as env var names, not values.
- Keep `.harness` sensitivity visible.
- Keep raw events framed as adapter debugging only.
- Prefer mock for credential-free examples.
