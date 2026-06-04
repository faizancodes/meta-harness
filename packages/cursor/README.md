# @metaharness/cursor

Cursor SDK adapter for metaharness. It supports local and configured cloud
Cursor runs where the SDK exposes the needed behavior, and maps Cursor events,
artifacts, git metadata, and provider capabilities into the portable harness
contract.

## Install

```bash
pnpm add @metaharness/core @metaharness/cursor
pnpm add -D @cursor/sdk
```

Set `CURSOR_API_KEY` before live cloud or authenticated runs.

## Use

```ts
import { createHarness, defineConfig } from "@metaharness/core";
import { CursorAdapter } from "@metaharness/cursor";

const harness = createHarness(
  defineConfig({
    workspace: { cwd: process.cwd() },
    defaultProvider: "cursor",
    providers: {
      cursor: {
        provider: "cursor",
        apiKeyEnv: "CURSOR_API_KEY",
        runtime: "local"
      }
    },
    rawEvents: false
  }),
  [new CursorAdapter()]
);

try {
  const caps = await harness.agent("cursor").capabilities();
  if (!caps.lifecycle.cancel.supported) {
    // Hide or disable cancellation for this runtime.
  }
} finally {
  await harness.dispose();
}
```

## Preflight

Before the first live Cursor run, check the provider this process will use. This
surfaces missing adapter registration, capability loading, and API-key
environment variable issues before a provider session starts:

```ts
const report = await harness.doctor({ provider: "cursor" });
const failedChecks = report.checks.filter((check) => check.status === "fail");

if (failedChecks.length > 0) {
  throw new Error("Cursor provider setup is not ready.");
}
```

## Notes

- Requires Node.js 22 or newer.
- Call `await harness.dispose()` from short script `finally` blocks or service
  shutdown hooks so adapters can release provider-native resources.
- The Cursor SDK is an optional peer dependency.
- Cursor local cancellation is intentionally reported as unsupported for
  `@cursor/sdk@1.0.17` because that SDK path is not process-clean.
- Cloud-specific options should stay explicit and should not be treated as
  portable provider behavior.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
