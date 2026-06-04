# sdk-basic

Run metaharness through the SDK with the mock provider. This example uses only
local built package entrypoints, so it does not need provider credentials.

From the repository root:

```bash
pnpm example:sdk
pnpm examples:smoke
```

If packages are already built, you can also run
`node examples/sdk-basic/index.mjs` directly.

The script:

- creates a typed config with `defineConfig()`
- registers `MockAdapter` explicitly with `createHarness()`
- runs `harness.doctor({ provider: "mock" })` before the first SDK run
- checks provider capabilities before streaming
- starts a run with `agent.startRun()`
- exports the `SessionLedger`
- prints the run, ledger, handoff, and changed-file summary

`index.ts` is the TypeScript-first version of the same pattern and is covered by
`pnpm typecheck:examples`. `index.mjs` is the direct Node runtime version used by
`pnpm example:sdk`.

Use this example as the SDK equivalent of the CLI mock quickstart. For real
providers, install the matching optional provider SDK peer and set the provider
API key environment variable before swapping adapters.
