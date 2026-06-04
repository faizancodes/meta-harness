# API Usage

Use this reference for consumer SDK integration, SDK examples, application code,
typed errors, event handling, compare, handoff, and embedding metaharness in
services or automation.

## Table Of Contents

- Decision guide
- Install matrix
- Config construction
- Adapter registration
- Doctor and preflight
- Capabilities
- Blocking runs
- Streaming runs
- Event handling
- Verification
- Results and artifacts
- Resume and handoff
- Compare
- Policy and telemetry
- Errors
- Application integration checklist
- Bad patterns

## Decision Guide

Use SDK when the caller needs structured TypeScript objects, events, typed
errors, internal UI integration, job orchestration, or direct control over
adapters.

Use CLI when the caller needs a human terminal workflow, quick repository
automation, CI shell steps, artifact inspection, or generated config/policy
files.

Use mock first for examples, tests, docs snippets, and onboarding. Move to real
providers only after `doctor` passes for the selected provider and the optional
provider SDK peer is installed.

## Install Matrix

Install only the packages for the providers the consumer actually runs.

Mock-only SDK:

```bash
pnpm add @metaharness/core @metaharness/adapter-mock
```

Codex SDK:

```bash
pnpm add @metaharness/core @metaharness/codex
pnpm add -D @openai/codex-sdk
```

Claude SDK:

```bash
pnpm add @metaharness/core @metaharness/claude
pnpm add -D @anthropic-ai/claude-agent-sdk
```

Cursor SDK:

```bash
pnpm add @metaharness/core @metaharness/cursor
pnpm add -D @cursor/sdk
```

Mixed provider app:

```bash
pnpm add @metaharness/core @metaharness/adapter-mock @metaharness/codex @metaharness/claude
pnpm add -D @openai/codex-sdk @anthropic-ai/claude-agent-sdk
```

Provider SDK environment variables:

| Provider | Adapter package             | Provider SDK peer                | API key env         |
| -------- | --------------------------- | -------------------------------- | ------------------- |
| Mock     | `@metaharness/adapter-mock` | none                             | none                |
| Claude   | `@metaharness/claude`       | `@anthropic-ai/claude-agent-sdk` | `ANTHROPIC_API_KEY` |
| Cursor   | `@metaharness/cursor`       | `@cursor/sdk`                    | `CURSOR_API_KEY`    |
| Codex    | `@metaharness/codex`        | `@openai/codex-sdk`              | `OPENAI_API_KEY`    |

Do not install every real provider SDK in examples unless the code runs every
provider. Optional peers are a core design constraint.

## Config Construction

Use `defineConfig()` to preserve config typing:

```ts
import { createHarness, defineConfig } from "@metaharness/core";
import { MockAdapter } from "@metaharness/adapter-mock";
import { CodexAdapter } from "@metaharness/codex";

const config = defineConfig({
  workspace: {
    cwd: process.cwd()
  },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" },
    codex: {
      provider: "codex",
      runtime: "local",
      apiKeyEnv: "OPENAI_API_KEY"
    }
  },
  policy: {
    file: "metaharness.policy.yaml"
  },
  storage: {
    rootDir: ".harness",
    redactSecrets: true
  },
  rawEvents: false
});

const harness = createHarness(config, [new MockAdapter(), new CodexAdapter()]);
```

Important fields:

- `workspace.cwd`: working directory used for provider work and artifact paths.
- `defaultProvider`: fallback when `provider` is omitted from run input.
- `providers`: provider config map keyed by caller-chosen provider id.
- `policy`: file or inline policy used for provider-native hints and harness
  guards.
- `storage.rootDir`: default `.harness`.
- `storage.redactSecrets`: keep true unless debugging in a controlled local
  environment.
- `rawEvents`: keep false unless debugging adapter event mapping.
- `telemetry`: optional tracing config. Use only when the app has a telemetry
  exporter strategy.

Use `ProviderConfig.native` for provider-native options that have no portable
field. Prefer portable fields first: `model`, `runtime`, `policy`,
`verification`, `limits`, `desiredOutput`, and `metadata`.

## Adapter Registration

Config entries and adapter instances are separate. Registering:

```ts
providers: {
  codex: {
    provider: "codex";
  }
}
```

does not run Codex by itself. The runtime must also receive:

```ts
new CodexAdapter();
```

If the config names a provider but the adapter is missing, calls should fail
with `AdapterNotFoundError`. This is intentional; it keeps optional peer
dependencies explicit.

Always dispose:

```ts
try {
  // use harness
} finally {
  await harness.dispose();
}
```

Dispose matters for providers that own subprocesses, native agents, app-server
transports, or SDK resources.

## Doctor And Preflight

Use doctor before first live work:

```ts
const report = await harness.doctor({ provider: "codex" });

for (const check of report.checks) {
  if (check.status === "fail") {
    throw new Error(`${check.category}: ${check.name} failed`);
  }
}
```

In product UI, render structured doctor checks instead of flattening them into a
single string. Important rows include adapter registration, provider SDK package
installation, API key presence, policy validity, storage writability, and git
workspace state.

Use `doctor({ provider })` for the provider about to run. Avoid `--all` style
checks in product code unless every configured provider is intentionally
required, because unused provider keys may be missing.

## Capabilities

Capabilities decide UI and automation behavior:

```ts
const agent = harness.agent(selectedProvider);
const caps = await agent.capabilities();

if (caps.lifecycle.stream.supported) {
  // show streaming transcript
}

if (caps.lifecycle.cancel.supported) {
  // show cancel button
}

if (caps.workspace.openPullRequest.supported) {
  // show PR output controls
}

if (caps.tools.mcp.supported) {
  // allow provider-native MCP config
}
```

Do not branch on provider strings when a capability flag exists. Provider
strings are acceptable inside:

- provider adapters
- provider-specific CLI validation
- tests that intentionally target one provider
- native escape-hatch configuration where no portable capability exists

Unsupported controls should be hidden, disabled, or explained. Calling an
unsupported public operation should throw `UnsupportedCapabilityError`.

## RunInput

Important fields:

- `task`: required user instruction.
- `mode`: `ask`, `edit`, `review`, `plan`, or `custom`.
- `provider`: optional if `defaultProvider` is configured.
- `model`: provider model hint.
- `runtime`: local, cloud, or self-hosted where supported.
- `workspace`: per-run workspace overrides.
- `policy`: per-run policy overrides.
- `limits`: per-run turn, duration, cost, file-count, or diff-byte limits.
- `desiredOutput`: message, patch, branch, or pull request intent.
- `verification`: harness-owned verification commands.
- `metadata`: caller metadata for audit or downstream systems.
- `native`: provider-specific escape hatches.
- `rawEvents`: per-run raw provider capture.

Use `metadata` for stable caller information, not prompt text. Example:

```ts
metadata: {
  ticketId: "PROJ-123",
  requestedBy: "ci",
  workflow: "nightly-fix"
}
```

## Blocking Runs

Use blocking runs for workers and simple automation:

```ts
const result = await harness.run({
  provider: "mock",
  mode: "ask",
  task: "Summarize this workspace in one paragraph.",
  verification: ["pnpm test"]
});

if (result.status !== "success") {
  throw new Error(result.finalMessage ?? "metaharness run failed");
}

console.log(result.finalMessage);
```

Use `harness.agent(provider).run(input)` when provider selection has already
been resolved:

```ts
const agent = harness.agent("codex");
const result = await agent.run({
  mode: "edit",
  task: "Fix the failing test with a minimal patch.",
  verification: ["pnpm test"]
});
```

Always check `result.status`. A provider-native completion can still produce a
failed harness result if verification fails, command policy is violated, or run
limits are exceeded.

## Streaming Runs

Use `startRun()` when the app needs live events, cancellation, or separate
waiting:

```ts
const active = await harness.startRun({
  provider: "codex",
  mode: "edit",
  task: "Fix the failing unit test.",
  verification: ["pnpm test"]
});

const streamTask = (async () => {
  for await (const event of active.events()) {
    switch (event.type) {
      case "assistant.message.delta":
        process.stdout.write(event.text);
        break;
      case "plan.updated":
        renderPlan(event.steps);
        break;
      case "command.started":
        renderCommand(event.command);
        break;
      case "error":
        renderError(event.error);
        break;
      default:
        logDebugEvent(event);
    }
  }
})();

const result = await active.wait();
await streamTask;
```

Event streams are normalized portable events. Do not parse raw provider payloads
for product behavior. Handle unknown event types defensively because new
portable event variants can be added.

Cancellation pattern:

```ts
const caps = await harness.agent("codex").capabilities();
if (caps.lifecycle.cancel.supported) {
  await active.cancel();
}
```

Cursor local cancellation caveat: for `@cursor/sdk@1.0.17`, metaharness reports
local Cursor cancellation as unsupported. Do not bypass the portable capability
flag and call provider-native local cancellation.

## Portable Events

Portable events are a discriminated union. Common categories:

- `run.started`, `run.completed`
- `assistant.message.delta`, `assistant.message.completed`
- `plan.updated`
- `tool.call.started`, `tool.call.completed`
- `command.started`, `command.finished`
- `file.changed`
- `diff.updated`
- `usage.updated`
- `approval.requested`, `approval.resolved`
- `error`
- `provider.raw` when raw capture is enabled and exposed

Requirements for adapter or event code:

- `seq` must be positive and monotonic.
- normalized events must validate against the event schema.
- raw provider payloads must stay under `provider.raw`.
- raw events must not be required for normal app features.
- terminal result and final `run.completed` status must align.

## Verification

Verification commands are harness-owned and should be simple commands:

```ts
verification: ["pnpm test", "pnpm lint"];
```

Avoid shell composition:

```ts
verification: ["pnpm test && pnpm lint"]; // wrong
verification: ["pnpm test | tee out.log"]; // wrong
```

Core parses and executes verification without a shell. This avoids shell
injection and keeps command policy auditable.

Verification failure marks the harness `RunResult` as failed even if the
provider completed. Inspect `verificationLogPath`.

## Results And Artifacts

Important `RunResult` fields:

- `status`: `success`, `failed`, or `cancelled`.
- `finalMessage`: final provider or harness summary.
- `eventLogPath`: normalized `events.ndjson`.
- `ledgerPath`: `SessionLedger` JSON.
- `handoffPath`: handoff prompt material.
- `patchPath`: `diff.patch`.
- `verificationLogPath`: verification output.
- `diff`: inline unified diff when available.
- `artifacts`: patch, branch, PR, file, screenshot, URL, or unknown artifacts.
- `usage`: token and cost data when providers expose it.
- `nativeRunId`, `nativeSessionId`, `providerRunUrl`: provider metadata.

Run storage layout:

```text
.harness/runs/<run-id>/
  events.ndjson
  result.json
  ledger.json
  handoff.md
  diff.patch
  verification.log
  provider/raw-events.ndjson
```

Treat `.harness/` as sensitive. Redaction applies to logs and JSON artifacts by
default, but `diff.patch` must remain applyable and can still contain secrets.

## Resume And Handoff

Same-provider resume uses provider-native state when available:

```ts
const resumed = await harness.resume({
  provider: "codex",
  session: nativeSessionId,
  task: "Continue and finish the fix."
});
```

Resume from ledger uses explicit run artifacts plus same-provider native session
ids when present:

```ts
const ledger = await harness.exportLedger(runId);
await harness.importLedger(ledger);
```

Cross-provider handoff is not native session transfer. It uses explicit
artifacts:

- prior ledger
- handoff markdown
- captured diff patch
- verification output
- caller instruction

Do not write docs or product text implying Claude, Cursor, and Codex hidden
state can be transferred.

## Compare

Use compare when the same task should be attempted across providers:

```ts
const comparison = await harness.compare({
  providers: ["claude", "codex"],
  task: "Implement the smallest safe fix.",
  verification: ["pnpm test"],
  strategy: {
    maxConcurrency: 1,
    isolatedWorktrees: true
  }
});
```

Compare preserves separate results. It does not auto-merge patches or choose a
winner unless product code does that explicitly.

Prefer isolated worktrees when providers may edit files. Keep concurrency low
for expensive providers or rate-limited accounts.

## Policy And Telemetry

Policy can be configured at harness or run level. It compiles to provider-native
hints plus observable harness guards. It is not a complete sandbox.

Telemetry is optional. Use `@metaharness/telemetry` only when the app has an
exporter strategy. Invalid telemetry config should fail with typed telemetry
errors, not silent no-ops.

## Errors

Catch typed errors by class or stable `code`:

```ts
import { HarnessError, UnsupportedCapabilityError } from "@metaharness/core";

try {
  await active.cancel();
} catch (error) {
  if (error instanceof UnsupportedCapabilityError) {
    disableCancelUi();
  } else if (error instanceof HarnessError) {
    reportHarnessCode(error.code);
  } else {
    throw error;
  }
}
```

Common public errors include:

- `HarnessInputError`
- `ProviderConfigError`
- `AdapterNotFoundError`
- `UnsupportedCapabilityError`
- `CommandPolicyViolationError`
- `RunLimitExceededError`
- `EventValidationError`
- `LedgerImportError`
- `RunArtifactError`
- `WorkspaceSnapshotError`
- `DirtyWorkspaceError`
- `GitCommandError`

Use `docs/error-codes.md` in the repo for the full stable code catalog.

## Application Integration Checklist

- Install only required adapters and provider SDK peers.
- Keep provider SDK keys in environment variables, not config files.
- Run doctor before real provider work.
- Branch optional UX on capabilities.
- Keep raw events disabled by default.
- Record the run id and artifact paths in job records.
- Store `.harness` artifacts according to the app security model.
- Surface verification failure separately from provider failure.
- Dispose harness resources on shutdown.
- Avoid provider strings except for selection, native options, and adapter code.

## Bad Patterns

Do not:

- write `if (provider === "cursor") showPrButton()` when
  `caps.workspace.openPullRequest.supported` exists.
- require all provider SDK peers for a mock-only or Codex-only example.
- call `active.cancel()` without checking capability support.
- parse `provider.raw` to power normal UI.
- claim handoff transfers provider-native hidden state.
- use shell pipelines in `verification`.
- commit `.harness` artifacts to a public repo.
