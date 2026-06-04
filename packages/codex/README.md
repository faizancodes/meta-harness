# @metaharness/codex

Codex adapter for metaharness. It supports Codex SDK mode and the explicit
app-server transport, maps Codex turns and notifications to portable run
events, and preserves Codex-specific capabilities instead of pretending every
provider behaves the same.

## Install

```bash
pnpm add @metaharness/core @metaharness/codex
pnpm add -D @openai/codex-sdk
```

Set `OPENAI_API_KEY` before live runs.

## Use

```ts
import { createHarness, defineConfig } from "@metaharness/core";
import { CodexAdapter } from "@metaharness/codex";

const harness = createHarness(
  defineConfig({
    workspace: { cwd: process.cwd() },
    defaultProvider: "codex",
    providers: {
      codex: {
        provider: "codex",
        apiKeyEnv: "OPENAI_API_KEY"
      }
    },
    rawEvents: false
  }),
  [new CodexAdapter()]
);

try {
  const result = await harness.run({
    provider: "codex",
    task: "Inspect the repository and summarize the highest-risk files."
  });

  console.log(result.status);
} finally {
  await harness.dispose();
}
```

## Preflight

Before the first live Codex run, check the provider this process will use. This
surfaces missing adapter registration, capability loading, and API-key
environment variable issues before a provider session starts:

```ts
const report = await harness.doctor({ provider: "codex" });
const failedChecks = report.checks.filter((check) => check.status === "fail");

if (failedChecks.length > 0) {
  throw new Error("Codex provider setup is not ready.");
}
```

## Notes

- Requires Node.js 22 or newer.
- Call `await harness.dispose()` from short script `finally` blocks or service
  shutdown hooks so adapters can release provider-native resources.
- The Codex SDK is an optional peer dependency.
- App-server mode is version-sensitive. Enable it only when the configured
  Codex app-server capability supports the behavior you need.
- Invalid native sandbox names fail with `CODEX_SANDBOX_MODE_UNSUPPORTED`
  before the optional SDK is loaded. Use `read-only`, `workspace-write`,
  `full-access`, or `danger-full-access`. See `docs/error-codes.md` in the
  metaharness repository.
- Use metaharness ledgers and diffs for handoff; do not assume native Codex
  thread state is portable across providers.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
