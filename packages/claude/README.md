# @metaharness/claude

Claude Agent SDK adapter for metaharness. It maps Claude Agent SDK sessions,
streaming messages, tool activity, usage, policy hooks, and result data into the
portable metaharness contract while keeping Claude-specific capability limits
visible.

## Install

```bash
pnpm add @metaharness/core @metaharness/claude
pnpm add -D @anthropic-ai/claude-agent-sdk
```

Set `ANTHROPIC_API_KEY` before live runs.

## Use

```ts
import { createHarness, defineConfig } from "@metaharness/core";
import { ClaudeAdapter } from "@metaharness/claude";

const harness = createHarness(
  defineConfig({
    workspace: { cwd: process.cwd() },
    defaultProvider: "claude",
    providers: {
      claude: {
        provider: "claude",
        apiKeyEnv: "ANTHROPIC_API_KEY"
      }
    },
    rawEvents: false
  }),
  [new ClaudeAdapter()]
);

try {
  const caps = await harness.agent("claude").capabilities();
  if (caps.lifecycle.resume.supported) {
    const result = await harness.run({
      provider: "claude",
      task: "Review the current workspace and propose the next safe change."
    });
    console.log(result.status);
  }
} finally {
  await harness.dispose();
}
```

## Preflight

Before the first live Claude run, check the provider this process will use. This
surfaces missing adapter registration, capability loading, and API-key
environment variable issues before a provider session starts:

```ts
const report = await harness.doctor({ provider: "claude" });
const failedChecks = report.checks.filter((check) => check.status === "fail");

if (failedChecks.length > 0) {
  throw new Error("Claude provider setup is not ready.");
}
```

## Notes

- Requires Node.js 22 or newer.
- Call `await harness.dispose()` from short script `finally` blocks or service
  shutdown hooks so adapters can release provider-native resources.
- The provider SDK is an optional peer dependency so consumers only install it
  when they use Claude.
- Invalid policy passed directly to the adapter fails as `CLAUDE_POLICY_INVALID`;
  normal harness runs validate configured run policy before provider work. See
  `docs/error-codes.md` in the metaharness repository.
- Claude-native session state stays provider-local. Use the metaharness ledger
  and handoff artifacts for explicit continuation.
- Raw provider events stay disabled unless `rawEvents` is explicitly enabled.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
