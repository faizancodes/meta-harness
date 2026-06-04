# Providers And Capabilities

Use this reference for provider selection, adapter work, provider-specific
configuration, capability updates, event mapping, optional peer loading, and
live provider caveats.

## Table Of Contents

- Provider selection principles
- Capability matrix rules
- Adapter contract
- Optional peer dependency pattern
- Provider summaries
- Native options
- Event mapping
- Session state
- Cancellation
- Capability-driven examples
- Adapter implementation checklist
- Provider-specific failure triage

## Provider Selection Principles

Select providers by task and capability, not by assuming equivalent behavior:

- Use **mock** for deterministic tests, docs, onboarding, and credential-free
  examples.
- Use **Claude** when Claude Agent SDK behavior, Claude tools, hooks, subagents,
  or Claude-native sessions are desired.
- Use **Cursor** when local/cloud Cursor agent execution, Cursor cloud PRs, or
  Cursor-native artifacts are desired.
- Use **Codex** when Codex SDK or app-server event surfaces are desired.

Application code should ask:

```ts
const caps = await harness.agent(provider).capabilities();
```

and branch on `caps`, not provider strings, whenever a portable capability flag
exists.

## Capability Matrix Rules

Capabilities are grouped into:

- `runtime`: local, cloud, selfHosted
- `lifecycle`: start, stream, wait, cancel, resume, fork
- `workspace`: readFiles, writeFiles, runCommands, gitDiff, gitBranch,
  openPullRequest, artifacts
- `tools`: mcp, skills, subagents, hooks, webSearch
- `policy`: filesystemSandbox, commandAllowDeny, networkControl,
  humanApprovals, providerNativePermissions
- `observability`: tokenUsage, cost, planEvents, diffEvents, commandEvents,
  fileChangeEvents, toolCallEvents, rawEventAccess

Each flag has:

- `supported: boolean`
- `stability: "stable" | "beta" | "experimental" | "unknown"`
- optional `notes`

Rules:

- Unsupported or unknown provider behavior must be represented honestly.
- Runtime-specific differences must be reflected by `capabilities(input?)`.
- A public unsupported operation must throw `UnsupportedCapabilityError`.
- Capability docs must be generated from installed adapters, not manually
  invented.
- Mock capabilities prove the portable harness contract, not real-provider
  support.

## Adapter Contract

Adapters implement `CodingAgentAdapter<TNativeSession, TNativeRun>`.

Required responsibilities:

- `provider`: one of `mock`, `claude`, `cursor`, `codex`.
- `version`: adapter version.
- `capabilities(input?)`: return an honest `ProviderCapabilities`.
- `startSession(config)`: create provider-native session state.
- `resumeSession(config)`: resume same-provider native state when supported.
- `run(session, input)`: start provider work and return a native run handle.
- `stream(run)`: yield monotonic `PortableRunEvent` values.
- `wait(run)`: return terminal `RunResult`.
- `cancel(run)`: cancel when supported or throw `UnsupportedCapabilityError`.
- `snapshot(session?)`: optionally add ledger material.
- `dispose()`: release native resources when needed.

Adapter code can branch on provider details because it is provider-specific.
Public examples and app code should branch on capabilities.

## Optional Peer Dependency Pattern

Provider adapter packages should:

- declare provider SDKs as optional peer dependencies
- dynamically import provider SDKs only when needed
- externalize provider SDKs in builds
- throw typed errors with installation guidance when SDK peers are missing
- avoid bundling provider-native binaries or auth/runtime code

Official provider SDK packages:

| Provider | Adapter               | Provider SDK                     |
| -------- | --------------------- | -------------------------------- |
| Claude   | `@metaharness/claude` | `@anthropic-ai/claude-agent-sdk` |
| Cursor   | `@metaharness/cursor` | `@cursor/sdk`                    |
| Codex    | `@metaharness/codex`  | `@openai/codex-sdk`              |

Do not use old Claude Code SDK package names. Do not reverse-engineer provider
auth flows.

## Provider Summaries

### Mock

Adapter: `@metaharness/adapter-mock`

Use for:

- deterministic conformance
- package tests
- docs examples
- credential-free CLI and SDK quickstarts
- downstream consumer smoke tests

Facts:

- in-process adapter
- synthetic events and deterministic results
- does not inspect or modify real files unless scripted for test behavior
- does not model provider-native hidden state

Do not use mock behavior as evidence that real providers support a feature.

### Claude

Adapter: `@metaharness/claude`

Provider SDK: `@anthropic-ai/claude-agent-sdk`

Important facts:

- Claude Agent SDK controls a long-lived Claude subprocess.
- Native Claude session state is provider-local.
- The SDK can expose tools, hooks, subagents, MCP, permissions, session ids,
  usage, and cost depending on provider behavior.
- Filesystem state must be captured through metaharness workspace diff and
  ledger, not by assuming native session state contains portable file state.

Implementation guidance:

- Load SDK with `await import("@anthropic-ai/claude-agent-sdk")`.
- Forward provider-native MCP, hooks, permissions, and native options through.
- Map only observed messages to portable events.
- Emit provider raw payloads only as `provider.raw`.
- Do not proxy consumer subscription login.

### Cursor

Adapter: `@metaharness/cursor`

Provider SDK: `@cursor/sdk`

Important facts:

- Cursor SDK is beta-sensitive.
- Local and cloud runtimes have different capabilities.
- Cloud repository behavior and PR creation are Cursor-specific.
- Native Cursor conversation state is not portable.
- Cursor local cancellation is currently unsupported in metaharness for
  `@cursor/sdk@1.0.17` because the SDK can emit a late unhandled Connect
  cancellation rejection after returning a cancelled result.

Implementation guidance:

- Load SDK with `await import("@cursor/sdk")`.
- Keep local and cloud capability flags separate.
- Local `Agent.create` should receive model/runtime config; current local
  default model is `composer-2` when no model is provided.
- Cursor cloud repository flags are provider-specific:
  `repo`, `startingRef`, `prUrl`, `autoCreatePr`, `skipReviewerRequest`,
  `workOnCurrentBranch`.
- Map assistant, thinking, tool, status, request, task, artifact, git, and
  result data only when present.
- Dispose native agents when SDK exposes `close()` or async disposal.

### Codex

Adapter: `@metaharness/codex`

Provider SDK: `@openai/codex-sdk`

Important facts:

- SDK mode uses Codex threads and exposes a smaller event surface.
- App-server mode exposes richer streamed plan, diff, usage, command,
  file-change, MCP, web-search, approval, and raw events.
- App-server protocol is version-sensitive.
- Native Codex thread state is provider-local.

Implementation guidance:

- Load SDK with `await import("@openai/codex-sdk")`.
- Do not claim app-server event richness when running SDK mode.
- Keep `persistExtendedHistory` false unless app-server capability supports
  full-history persistence.
- Use explicit sandbox mode for edit/live conformance when workspace writes are
  expected, such as `workspace-write`.
- Surface app-server approvals as portable `approval.requested`.
- Without an approval resolver, decline conservatively in unattended contexts.

## Native Options

Use portable fields first:

- `model`
- `runtime`
- `workspace`
- `policy`
- `limits`
- `desiredOutput`
- `metadata`
- `verification`

Use `ProviderConfig.native` and `RunInput.native` only for provider-specific
settings that are intentionally not portable.

Document native usage clearly and keep the ledger truthful. Native options must
not create the impression that the capability is portable.

## Event Mapping

Adapters must:

- emit valid `PortableRunEvent` values
- keep `seq` positive and monotonic
- emit portable events before raw events where both exist
- map only observed provider behavior
- represent raw provider payloads under `provider.raw`
- keep raw events out of normalized product logic
- append typed `error` events for failures
- produce a terminal `RunResult`

Map these when observed:

- assistant deltas and completions
- plan/task updates
- tool call start/completion
- command start/finish
- file changes
- diff updates
- usage
- approvals
- artifacts
- provider metadata

Do not invent plan, diff, command, usage, or artifact events just to make
providers look equivalent.

## Session State

Same-provider resume can use native session ids when supported. Cross-provider
handoff cannot.

Use:

- `nativeSessionId` for same-provider resume
- `SessionLedger` for portable run context
- `handoff.md` for explicit prompt context
- `diff.patch` for file state
- `verification.log` for proof and failure context

Never claim Claude native sessions can become Cursor native sessions, or Codex
threads can become Claude sessions.

## Cancellation

Always check:

```ts
const caps = await harness.agent(provider).capabilities();
if (caps.lifecycle.cancel.supported) {
  await active.cancel();
}
```

Provider details:

- Mock cancellation is stable for async test runs.
- Claude cancellation is beta and forwarded through SDK abort behavior.
- Cursor local cancellation is unsupported for `@cursor/sdk@1.0.17`.
- Cursor cloud cancellation may be beta if SDK/runtime supports it.
- Codex cancellation is beta; SDK mode uses abort behavior and app-server mode
  uses interrupt semantics.

Do not mask provider cancellation problems with global unhandled rejection
handlers. Fix capability truthfulness or adapter handling.

## Capability-Driven Examples

Good:

```ts
const caps = await harness.agent(provider).capabilities();
if (caps.workspace.openPullRequest.supported) {
  enablePullRequestOutput();
}
```

Bad:

```ts
if (provider === "cursor") {
  enablePullRequestOutput();
}
```

Acceptable provider-string branches:

- adapter internals
- provider-specific CLI flag validation
- provider-native `native` option construction
- tests that assert provider-specific behavior

## Adapter Implementation Checklist

Before changing an adapter:

1. Check installed provider SDK version in `package.json` and `pnpm-lock.yaml`.
2. Use current provider SDK docs for syntax and behavioral assumptions.
3. Update capability flags before exposing or disabling behavior.
4. Add or update adapter tests.
5. Add or update integration conformance when portable behavior changes.
6. Update provider docs and generated capabilities if capability notes changed.
7. Keep provider SDK imports dynamic.
8. Keep provider SDK packages external in builds.
9. Keep raw provider event capture gated.
10. Run focused package tests, then broader repo validation.

## Provider-Specific Failure Triage

When a real provider fails:

1. Run `hk doctor --provider <provider>`.
2. Confirm optional provider SDK peer is installed.
3. Confirm API key env var is present without printing it.
4. Check the selected runtime and model.
5. Check capability support for the attempted operation.
6. Inspect normalized events first.
7. Enable raw events only for adapter debugging.
8. Reproduce with mock only if testing harness plumbing.
9. Reproduce with live provider gate only when credentials are intentionally
   available.
10. Report provider caveats honestly in docs and capabilities.
