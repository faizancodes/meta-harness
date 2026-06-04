# @metaharness/core

Core TypeScript runtime for metaharness. It provides the harness API, portable
event model, run storage, session ledgers, handoff, compare, doctor checks,
workspace capture, policy hooks, and typed provider capabilities.

## Install

```bash
pnpm add @metaharness/core
```

Install at least one adapter package alongside core:

```bash
pnpm add @metaharness/core @metaharness/adapter-mock
```

## Use

```ts
import { createHarness, defineConfig } from "@metaharness/core";
import { MockAdapter } from "@metaharness/adapter-mock";

const config = defineConfig({
  workspace: { cwd: process.cwd() },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" }
  },
  storage: {
    rootDir: ".harness",
    redactSecrets: true
  },
  rawEvents: false
});

const harness = createHarness(config, [new MockAdapter()]);
try {
  const agent = harness.agent("mock");
  const caps = await agent.capabilities();

  if (caps.lifecycle.stream.supported) {
    const active = await agent.startRun({
      task: "Inspect the workspace and summarize the current state."
    });

    for await (const event of active.events()) {
      if (event.type === "assistant.message.delta") {
        process.stdout.write(event.text);
      }
    }

    console.log(await active.wait());
  }
} finally {
  await harness.dispose();
}
```

## Preflight

Before the first run in an application, worker, or platform integration, check
the provider this process will use:

```ts
const report = await harness.doctor({ provider: "mock" });
const failedChecks = report.checks.filter((check) => check.status === "fail");

if (failedChecks.length > 0) {
  throw new Error("Mock provider setup is not ready.");
}
```

## Common SDK Workflows

Run results include the portable run id and artifact paths you need for audit,
replay, and handoff:

```ts
const runResult = await harness.run({
  provider: "mock",
  task: "Summarize this workspace and report verification status.",
  verification: ["pnpm test"]
});

console.log(runResult.runId);
console.log(runResult.ledgerPath);
console.log(runResult.handoffPath);
console.log(runResult.patchPath);
```

Compare results keep provider summaries and run artifacts side by side. Use the
run id from `compareResult.runs` when inspecting a selected provider result:

```ts
const compareResult = await harness.compare({
  providers: ["mock"],
  task: "Try the safest small fix.",
  verification: ["pnpm test"]
});

for (const [index, entry] of compareResult.summary.entries()) {
  const providerRun = compareResult.runs[index];
  console.log(entry.provider, providerRun?.runId, entry.testsPassed);
}

console.log(compareResult.compareMarkdownPath);
```

Handoff renders explicit context from the source run and starts a destination
run. It does not transfer hidden provider-native session state:

```ts
const sourceRun = await harness.run({
  provider: "mock",
  task: "Prepare visible state for handoff."
});

const handoff = await harness.handoff({
  fromRunId: sourceRun.runId,
  toProvider: "mock",
  instruction: "Continue from the visible ledger and verification output.",
  verification: ["pnpm test"]
});

console.log(handoff.handoffPromptPath);
console.log(handoff.toRun.runId);
console.log(handoff.toRun.ledgerPath);
```

## Notes

- Requires Node.js 22 or newer.
- Call `await harness.dispose()` from short script `finally` blocks or service
  shutdown hooks so adapters can release provider-native resources.
- Branch on `ProviderCapabilities`, not provider strings, when building product
  behavior.
- Use `validateHarnessConfig()` when loading config objects from user-controlled
  files or platform settings. It returns the parsed config or actionable
  diagnostics without choosing a CLI- or action-specific error code.
- Catch `HarnessError` subclasses or inspect `error.code` for product behavior;
  invalid SDK inputs and provider-native config fail before unsafe provider work.
  See `docs/error-codes.md` in the metaharness repository.
- Hidden provider-native session state is not portable. Use `SessionLedger`,
  `handoff.md`, `diff.patch`, and verification output for cross-provider
  continuation.
- `.harness/` artifacts can contain prompts, transcripts, diffs, command
  summaries, and provider metadata. Treat them as sensitive.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
