# Adapters

Adapters implement `CodingAgentAdapter<TNativeSession, TNativeRun>`.

## Lifecycle

Adapter `RunHandle` is the provider-native run handle used internally by core.
The public SDK `ActiveRun` returned by `harness.startRun()` wraps that adapter
handle with replayable `events()`, `wait()`, and `cancel()` methods.

| Method                  | Responsibility                                                       |
| ----------------------- | -------------------------------------------------------------------- |
| `capabilities(context)` | Return honest `ProviderCapabilities`.                                |
| `startSession(config)`  | Create a native provider session handle.                             |
| `resumeSession(config)` | Resume provider-native state when supported.                         |
| `run(session, input)`   | Start a provider run and return a portable `RunHandle`.              |
| `stream(run)`           | Yield `PortableRunEvent` in sequence order.                          |
| `wait(run)`             | Return terminal `RunResult`.                                         |
| `cancel(run)`           | Cancel when supported; otherwise throw `UnsupportedCapabilityError`. |
| `dispose()`             | Clean up native resources when needed.                               |

## Capabilities

Capabilities are grouped by runtime, lifecycle, workspace, tools, policy, and
observability. Unsupported capabilities must be represented with
`supported: false`, and calls to unsupported operations must fail with
`UnsupportedCapabilityError`.

Application code should branch on capabilities:

```ts
const agent = harness.agent(selectedProvider);
const caps = await agent.capabilities();

if (caps.workspace.openPullRequest.supported) {
  // Enable PR controls.
}
```

Do not branch examples or product logic on provider strings when a capability flag
exists.

## Optional Provider SDKs

Provider SDK packages are optional peers:

- `@metaharness/claude` -> `@anthropic-ai/claude-agent-sdk`
- `@metaharness/cursor` -> `@cursor/sdk`
- `@metaharness/codex` -> `@openai/codex-sdk`

Adapters load provider SDKs with dynamic imports so installing metaharness does not
force every provider runtime into the consumer application. Missing optional peers
produce typed harness errors with installation guidance.

The root repository installs real provider SDKs as dev dependencies so live
conformance can run. It also installs the Claude Agent SDK's required companion
peers, `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk`, because this repo sets
`auto-install-peers=false` and should not show setup-time peer warnings.
Consumer applications should still install only the adapters and provider SDKs
they actually run, then satisfy any peer warnings from those provider SDKs.

Builds mark provider SDKs external so packages stay lightweight and do not bundle
provider-native binaries or auth/runtime code.

## Native Escape Hatches

`RunInput.model` and `RunInput.runtime` are portable session hints. When present,
core passes them to `startSession()` or `resumeSession()` for that run, overriding
the provider config defaults, and records them in the session ledger. Providers
still report support through `ProviderCapabilities.runtime`; unsupported runtimes
remain provider-specific behavior, not a portability guarantee.

`ProviderConfig.native` and `RunInput.native` pass provider-specific options to
adapters. Use these for provider features that are real but not portable. Document
the capability and keep portable logs truthful.

The CLI exposes Cursor cloud repository setup as an explicit provider-specific
path:

```bash
pnpm hk run --provider cursor --runtime cloud --repo https://github.com/org/repo --task "Fix failing tests"
```

`--repo`, `--starting-ref`, `--pr-url`, `--auto-create-pr`,
`--skip-reviewer-request`, and `--work-on-current-branch` map to Cursor native
cloud options. They intentionally fail for non-Cursor providers and for non-cloud
runtime because repository-backed cloud execution is not a portable capability.
Cursor provider-native resume uses `Agent.resume(agentId)` when the SDK exposes it;
the follow-up prompt is then sent through the resumed agent. This is still
provider-native Cursor state, not a portable session transfer.

Codex app-server approval requests can be resolved with
`new CodexAdapter({ appServerApprovalResolver })`. The resolver receives the raw
JSON-RPC request and the portable `approval.requested` event, then returns a
portable decision plus an optional provider response payload. Without a resolver,
metaharness keeps the unattended CI default conservative and declines provider
approval requests.

## Event Mapping

Adapters should:

- emit portable events before raw events when both are available
- preserve provider event data only in `provider.raw`
- avoid inventing tool, plan, diff, or usage events that were not observed
- redact via core storage rather than adapter-specific string handling
- include raw event access only behind `rawEvents`

## Current Adapters

| Adapter                     | Status                                                                     |
| --------------------------- | -------------------------------------------------------------------------- |
| `@metaharness/adapter-mock` | Deterministic in-process adapter for conformance and CI.                   |
| `@metaharness/claude`       | Claude Agent SDK adapter using `query()` streaming and native session ids. |
| `@metaharness/cursor`       | Cursor SDK adapter for local/cloud runtime where supported by the SDK.     |
| `@metaharness/codex`        | Codex SDK adapter plus explicit app-server mode for richer events.         |
