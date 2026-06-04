# SDK Usage

Use the SDK when an application, internal platform, or automation service needs
to run coding agents through metaharness without shelling out to `hk`.

The SDK has one portable harness contract, but providers keep their own
capabilities and limitations. Do not build product logic that assumes Claude,
Cursor, Codex, and mock are interchangeable.

For a credential-free runnable example from this repository, use:

```bash
pnpm example:sdk
```

The TypeScript source for that pattern lives at `examples/sdk-basic/index.ts`
and is covered by `pnpm typecheck:examples`.

## Install

Install core plus the adapter packages you need. Provider SDKs are optional peer
dependencies, so install only the SDK peers for providers you will run.

Mock only:

```bash
pnpm add @metaharness/core @metaharness/adapter-mock
```

Codex:

```bash
pnpm add @metaharness/core @metaharness/codex
pnpm add -D @openai/codex-sdk
```

Claude and Cursor:

```bash
pnpm add @metaharness/core @metaharness/claude @metaharness/cursor
pnpm add -D @anthropic-ai/claude-agent-sdk @cursor/sdk
```

Provider SDKs use provider-supported environment variables such as
`ANTHROPIC_API_KEY`, `CURSOR_API_KEY`, and `OPENAI_API_KEY`.

## SDK Surface At A Glance

Most applications use the SDK through a small set of entry points. Start with
the blocking APIs for workers and automation, then move to the `ActiveRun` APIs
when a UI or service needs live events, cancellation, or separate wait logic.

| Need                           | API                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Preserve config typing         | `defineConfig()`                                                                                                                     |
| Create the runtime             | `createHarness(config, adapters)`                                                                                                    |
| Select a provider              | `harness.agent(provider)`                                                                                                            |
| Inspect provider capabilities  | `harness.agent(provider).capabilities()`                                                                                             |
| Preflight local setup          | `harness.doctor({ provider })`                                                                                                       |
| Run to completion              | `harness.run(input)` or `harness.agent(provider).run(input)`                                                                         |
| Stream, wait, or cancel        | `harness.startRun(input)` or `harness.agent(provider).startRun(input)` returns `ActiveRun` with `events()`, `wait()`, and `cancel()` |
| Continue a native session      | `harness.resume(input)` or `harness.startResume(input)`                                                                              |
| Compare providers              | `harness.compare(input)`                                                                                                             |
| Handoff between providers      | `harness.handoff(input)`                                                                                                             |
| Export/import portable context | `harness.exportLedger(runId)` and `harness.importLedger(pathOrLedger)`                                                               |
| Check policy configuration     | `harness.policy.check(input)`                                                                                                        |
| Release adapter resources      | `harness.dispose()`                                                                                                                  |

These methods expose portable metaharness behavior, not a promise that every
provider can do the same thing. Use `capabilities()` before showing optional
workflow controls such as cancellation, pull requests, MCP-backed tools, or
provider-native session continuation.

## Construct A Harness

`defineConfig()` preserves config typing. `createHarness(config, adapters)`
registers the concrete adapters this process can run.

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
      apiKeyEnv: "OPENAI_API_KEY",
      runtime: "local"
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

Registering a provider in config is not enough by itself. The matching adapter
instance must be passed to `createHarness()`, otherwise calls for that provider
fail with `AdapterNotFoundError`.

Call `await harness.dispose()` when a short script exits or a long-running
service shuts down so adapters can release provider-native resources. The
credential-free SDK example uses a `try`/`finally` block for this lifecycle.

For the full config shape, including workspace, provider, policy, storage,
telemetry, and raw-event fields, see [Configuration](configuration.md).

## Preflight Provider Setup

Use `harness.doctor()` before the first run in an application, worker, or
platform integration. It checks core setup plus the selected provider's adapter
registration, capability loading, and configured API key environment variable.

```ts
const report = await harness.doctor({ provider: "mock" });

for (const check of report.checks) {
  if (check.status === "fail") {
    throw new Error(`${check.category}: ${check.name} failed`);
  }
}
```

SDK doctor reports are intentionally structured so product code can render its
own setup UI. The CLI `hk doctor` adds terminal-oriented install checks, JSON
output, and next-step text for repository workflows.

## Check Capabilities

Branch on `ProviderCapabilities`, not provider strings, outside adapter internals
and provider-specific CLI validation.

```ts
const provider = "codex" as const;
const agent = harness.agent(provider);
const caps = await agent.capabilities();

if (caps.lifecycle.cancel.supported) {
  // Show a cancel button for this provider/runtime.
}

if (caps.workspace.openPullRequest.supported) {
  // Enable PR-specific workflow controls.
}
```

Unsupported behavior should be hidden, disabled, or handled explicitly. If a
public unsupported operation is called, metaharness throws
`UnsupportedCapabilityError`.

## Typed Errors

Catch metaharness failures by class or stable `code` when product behavior needs
to branch on the cause.

```ts
import { HarnessError } from "@metaharness/core";

function metaharnessCode(error: unknown): string | undefined {
  return error instanceof HarnessError ? error.code : undefined;
}
```

Relevant public errors include `HarnessInputError`, `ProviderConfigError`,
`AdapterNotFoundError`, `UnsupportedCapabilityError`, `CommandPolicyViolationError`,
`RunLimitExceededError`, `EventValidationError`, `LedgerImportError`,
`RunArtifactError`, `WorkspaceSnapshotError`, `DirtyWorkspaceError`, and
`GitCommandError`.

Invalid SDK inputs fail before provider sessions start. Stable input codes
include `RUN_TASK_MISSING`, `COMPARE_TASK_MISSING`, `COMPARE_NO_PROVIDERS`,
`HANDOFF_SOURCE_MISSING`, and `HANDOFF_PROVIDER_MISSING`.

The optional `@metaharness/telemetry` package exports `TelemetryConfigError` and
`TelemetrySetupError` for setup failures such as
`TELEMETRY_EXPORTER_UNSUPPORTED` and `TELEMETRY_TRACER_PROVIDER_CONFLICT`.

For the full stable code catalog, see [Error codes](error-codes.md).

## Run To Completion

Use `harness.run()` for blocking automation.

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
console.log(result.ledgerPath);
```

Important result fields:

- `status`: `success`, `failed`, or `cancelled`.
- `finalMessage`: final provider or harness summary.
- `eventLogPath`, `ledgerPath`, `handoffPath`, `patchPath`,
  `verificationLogPath`: run artifact paths.
- `diff`: unified diff when captured inline.
- `artifacts`: provider or harness artifacts such as patches, branches, PRs,
  files, and URLs.
- `usage`: token and cost data when exposed by the provider.
- `nativeRunId`, `nativeSessionId`, `providerRunUrl`: provider-native metadata
  when exposed.

Do not assume provider-native success means verification passed. Failed
verification marks the metaharness `status` as `failed`; inspect
`verificationLogPath`, the ledger, and the final `run.completed` event for the
specific command output.

## Stream Events

Use `startRun()` when a UI or service needs live events, `wait()`, or `cancel()`.

```ts
const active = await harness.startRun({
  provider: "mock",
  mode: "edit",
  task: "Fix the failing test with the smallest patch.",
  verification: ["pnpm test"]
});

const eventsTask = (async () => {
  for await (const event of active.events()) {
    switch (event.type) {
      case "assistant.message.delta":
        process.stdout.write(event.text);
        break;
      case "plan.updated":
        console.log(event.steps.map((step) => step.step).join("\n"));
        break;
      case "error":
        console.error(event.error.message);
        break;
    }
  }
})();

const result = await active.wait();
await eventsTask;
```

The portable event stream is a discriminated union. Ignore or summarize event
types your application does not render. Do not parse `provider.raw` for normal
product behavior.

## Artifacts And Ledger

Every run writes under `.harness/runs/<run-id>/` by default:

```text
events.ndjson
result.json
ledger.json
handoff.md
diff.patch
verification.log
provider/raw-events.ndjson
```

Use `harness.exportLedger(runId)` for the portable `SessionLedger`.

```ts
const ledger = await harness.exportLedger(result.runId);
console.log(ledger.provider.id);
console.log(ledger.files.changed.map((file) => file.path));
```

`harness.importLedger(pathOrLedger)` accepts either a `SessionLedger` object or a
JSON file path. Missing, unreadable, invalid JSON, or schema-invalid ledger path
input throws `LedgerImportError` with a stable error code; relative paths resolve
from the current Node process working directory.

The ledger captures explicit portable context: prompt, transcript summaries,
plan snapshots, commands, tools, files, diff, verification, artifacts, usage, and
final summary. It does not make hidden provider-native session state portable.

## Resume And Handoff

Use resume for same-provider native continuation when you have a provider-native
session id or a prior ledger from the same provider.

```ts
const resumed = await harness.resume({
  provider: "codex",
  nativeSessionId: result.nativeSessionId,
  task: "Continue from the previous native session."
});
```

Use handoff when moving work between providers. Handoff uses explicit artifacts:
the session ledger, handoff markdown, captured diff, and verification log.

```ts
const handoff = await harness.handoff({
  fromRunId: result.runId,
  toProvider: "codex",
  instruction: "Continue from the ledger and finish verification.",
  applyPatch: true,
  verification: ["pnpm test"]
});

console.log(handoff.handoffPromptPath);
console.log(handoff.toRun.status);
```

Do not claim hidden native Claude, Cursor, or Codex session state transfers
between providers.

## Raw Events

Raw provider events are disabled by default. Enable them only for adapter
debugging in trusted environments:

```ts
await harness.run({
  provider: "codex",
  task: "Debug provider event mapping.",
  rawEvents: true
});
```

Normalized `events.ndjson`, `result.json`, `ledger.json`, `handoff.md`, and raw
logs pass through redaction when `storage.redactSecrets` is not disabled.
`diff.patch` remains applyable and should still be treated as sensitive.

## MCP

metaharness does not replace MCP. Pass MCP configuration through provider-native
options where a provider SDK supports it, then use metaharness policy, telemetry,
redaction, and ledger capture around the run.
