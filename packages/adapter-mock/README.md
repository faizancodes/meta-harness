# @metaharness/adapter-mock

Deterministic in-process adapter for tests, examples, CI, and local onboarding.
It exercises the portable metaharness contract without external credentials or
provider SDKs.

## Install

```bash
pnpm add @metaharness/core @metaharness/adapter-mock
```

## Use

```ts
import { createHarness, defineConfig } from "@metaharness/core";
import { MockAdapter } from "@metaharness/adapter-mock";

const harness = createHarness(
  defineConfig({
    workspace: { cwd: process.cwd() },
    defaultProvider: "mock",
    providers: {
      mock: { provider: "mock" }
    }
  }),
  [new MockAdapter()]
);

try {
  const result = await harness.run({
    task: "Smoke test the portable harness flow."
  });

  console.log(result.finalMessage);
} finally {
  await harness.dispose();
}
```

## Preflight

Before the first mock run in smoke tests or CI examples, use the mock provider
doctor so adapter registration and artifact setup failures are caught before a
run starts:

```ts
const report = await harness.doctor({ provider: "mock" });
const failedChecks = report.checks.filter((check) => check.status === "fail");

if (failedChecks.length > 0) {
  throw new Error("Mock provider setup is not ready.");
}
```

## Notes

- Requires Node.js 22 or newer.
- Call `await harness.dispose()` from short script `finally` blocks or service
  shutdown hooks so adapter cleanup stays explicit.
- The mock adapter emits synthetic events, usage, patch artifacts, and command
  events.
- It does not inspect the filesystem, execute commands, call a network service,
  or model real provider-native behavior.
- Use it to test portable lifecycle, event, ledger, compare, and handoff code
  before enabling live provider gates.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
