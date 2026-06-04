# Policy

Policy is a portable metaharness configuration layer plus provider-native hints.
It is not a complete sandbox by itself.

## File

`hk init` writes `metaharness.policy.yaml`:

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

The default filesystem deny list blocks common secret-bearing env files while
leaving the tracked placeholder [.env.example](../.env.example) available for
documentation and onboarding. Add project-specific secret file names to
`filesystem.deny` if your environment uses additional `.env` naming conventions.

## Sections

| Section             | Purpose                                                                            |
| ------------------- | ---------------------------------------------------------------------------------- |
| `filesystem`        | `read-only`, `workspace-write`, or `full-access`; writable roots and denied paths. |
| `network`           | `allow`, `deny-by-default`, or `provider-default`; explicit allowed hosts.         |
| `commands`          | Default allow/deny plus glob-like allow and deny patterns.                         |
| `approvals`         | Reasons requiring human approval.                                                  |
| `secrets`           | Environment variable names and regexes to redact.                                  |
| `limits`            | Turns, duration, cost, changed files, and diff byte limits.                        |
| `providerOverrides` | Provider-specific escape hatch merged into compiled native policy.                 |

## Compilation

`compileProviderPolicy(provider, policy)` returns:

- `nativeConfig`: provider-native options where a mapping exists
- `harnessGuards`: command policy, diff limits, duration limits, cost limits, and
  approval requirements
- `warnings`: typed diagnostics for incomplete or runtime-dependent enforcement

Examples:

- Claude maps filesystem mode into allowed/disallowed tools and permission mode.
- Cursor maps local filesystem mode and network host hints, with beta/runtime
  warnings.
- Codex maps filesystem mode into sandbox mode and forwards approval policy.

When `HarnessConfig.policy` or `RunInput.policy` is set, core validates the policy
before starting the provider session and forwards compiled native policy hints into
the provider's native session/run options. Provider-specific `native` escape
hatches still remain available for explicit overrides.

## Command Checks

`evaluateCompiledCommandPolicy()` checks a command against the portable command
policy. Provider command execution may still be provider-native; metaharness
records observable command events and applies harness guards where the core can
observe the outcome. If a provider emits `command.started` or `command.finished`
for a command that the compiled policy denies or requires approval for, core marks
the harness result `failed`, appends a `COMMAND_POLICY_VIOLATION` error event, and
records the provider's original completion events for auditability.

## Limit Checks

Core enforces observable limits from `HarnessConfig.policy`, `RunInput.policy`, and
`RunInput.limits` after provider completion, verification, and diff capture.
Direct `RunInput.limits` override policy-provided values for that run:

- `maxDurationMs` uses elapsed harness run time.
- `maxTurns` uses the count of portable `assistant.message.completed` events.
- `maxCostUsd` uses `RunResult.usage.estimatedCostUsd` or the latest
  `usage.updated` event with estimated cost.
- `maxFilesChanged` uses the workspace diff, file-change events, and unified diff
  headers.
- `maxDiffBytes` uses the captured unified diff byte length.

When a limit is exceeded, the run result is written as `failed` with a
`RUN_LIMIT_EXCEEDED` error event and a final harness `run.completed` event. Native
provider completion events remain in the log for auditability. Adapters may also
forward `maxTurns` to provider-native turn-limit options where SDKs expose them,
but core still enforces the observable portable turn count.

## CLI

```bash
pnpm hk policy check --policy-file metaharness.policy.yaml --provider codex
```

Use `policy check` before a run to validate policy syntax and portable
metaharness rules. Add `--provider` when you want provider-specific warnings for
the provider you are about to run. Use `--json` for machine-readable
diagnostics. The command exits nonzero when validation fails.

Compile provider-native hints and harness guards:

```bash
pnpm --silent hk policy compile --provider codex --json
```

`policy compile` requires `--provider` because provider-native hints are
provider-specific.

The compile output includes:

- `nativeConfig`: provider-native policy hints
- `harnessGuards`: portable guards metaharness can enforce or audit
- `warnings`: provider-specific limitations and downgrade notes

Compilation exits nonzero only when the policy cannot be parsed or validated.
Provider warnings are advisory.

## SDK

`createHarness()` exposes a policy facade for the same checks:

```ts
const diagnostics = await harness.policy.check({
  file: "metaharness.policy.yaml",
  provider: "codex"
});

if (!diagnostics.ok) {
  throw new Error(diagnostics.errors.map((error) => error.message).join("\n"));
}
```

The core package loads `@metaharness/policy` dynamically for this method so core
stays lightweight. Missing policy files or a missing policy package are reported
as typed `PolicyCheckResult` diagnostics.
