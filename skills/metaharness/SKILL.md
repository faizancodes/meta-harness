---
name: metaharness
description: Use metaharness SDK and CLI correctly for provider-aware Claude, Cursor, Codex, and mock coding-agent workflows.
---

# Metaharness

## Core Model

Treat metaharness as a production harness layer for coding agents, not as a
model gateway, editor protocol, MCP replacement, or provider-equality wrapper.

The central rule is: preserve provider differences in code, docs, and UX.
metaharness gives one operational surface for lifecycle, streaming, wait,
cancel, resume, policy, telemetry, diffs, ledgers, compare, and handoff, while
`ProviderCapabilities` says which parts are actually supported for a selected
provider/runtime.

Use these invariants everywhere:

- Branch public app logic on `ProviderCapabilities`, not provider strings, when
  a capability flag exists.
- Use only the official provider SDK packages:
  `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`, and `@openai/codex-sdk`.
- Keep provider SDKs as optional peer dependencies; install and load only the
  provider SDKs the consumer actually runs.
- Pass MCP configuration through to provider-native MCP support. Do not design a
  separate metaharness-native MCP abstraction.
- Treat provider-native session state as provider-local. Handoff uses
  `SessionLedger`, `handoff.md`, `diff.patch`, and verification output.
- Keep raw provider events disabled unless debugging adapter behavior.
- Treat `.harness/` artifacts as sensitive because they can contain prompts,
  transcripts, diffs, command summaries, provider metadata, and raw events.

## First Decision

Classify the task before writing code:

1. **Consumer SDK usage**: User is embedding metaharness in an app, service,
   worker, CI orchestration layer, internal platform, or script. Read
   `references/api-usage.md`.
2. **CLI or GitHub Action workflow**: User is running or documenting `hk`,
   `hk init`, `hk run`, `hk compare`, `hk handoff`, run artifacts, or generated
   CI workflows. Read `references/cli-workflows.md`.
3. **Provider adapter or capability work**: User is changing Claude, Cursor,
   Codex, mock adapters, optional peer loading, native options, event mapping,
   cancellation, resume, or `ProviderCapabilities`. Read
   `references/providers.md`.
4. **Policy, security, redaction, verification, or CI safety**: User is working
   on policy YAML, command checks, sandbox hints, secrets, raw events,
   verification commands, public CI, or `.harness` artifacts. Read
   `references/policy-security.md`.
5. **Tests, release, live provider checks, or generated docs/schemas**: User is
   validating changes, fixing conformance, running live providers, or updating
   generated artifacts. Read `references/conformance.md`.

If a task crosses domains, read only the matching references together. Avoid
loading every reference by default.

## Current Documentation

When inside the metaharness repo, read the relevant local docs before changing
behavior:

- `README.md`
- `docs/sdk.md`
- `docs/cli.md`
- `docs/architecture.md`
- `docs/adapters.md`
- `docs/provider-capabilities.md`
- `docs/policy.md`
- `docs/conformance.md`
- `docs/development.md`
- relevant package source and tests

For external provider SDK syntax, use current official docs. Use Context7 for
library/framework/API docs when applicable. For OpenAI or Codex product/API
questions, use the OpenAI docs skill or official OpenAI sources.

## Consumer Usage Workflow

Use this order for application integration:

1. Pick SDK vs CLI. Use SDK for app/service code that needs structured results
   and events. Use CLI for local development, shell-driven CI, artifact
   inspection, and repo automation.
2. Install only needed packages. Mock examples install core plus mock. Real
   providers install core, matching adapter packages, and matching provider SDK
   optional peers.
3. Build config with `defineConfig()`. Set `workspace.cwd`, providers,
   `defaultProvider`, storage, policy, telemetry, and `rawEvents: false`.
4. Pass concrete adapters to `createHarness(config, adapters)`. A provider entry
   in config is not enough; the matching adapter instance must be registered.
5. Run `harness.doctor({ provider })` or `hk doctor --provider <provider>`
   before real work.
6. Check `capabilities()` before exposing optional controls such as cancellation,
   PR creation, MCP tools, native resume, or raw event access.
7. Prefer `harness.run()` for blocking jobs. Prefer `harness.startRun()` when a
   UI or worker needs live events, cancellation, or separate wait handling.
8. Inspect the harness `RunResult.status`, verification artifacts, and final
   portable events. Do not treat provider-native success as verification success.
9. Use `SessionLedger`, patches, and verification logs for continuation. Do not
   claim hidden session state can move across providers.
10. Call `await harness.dispose()` in scripts and service shutdown paths.

## Repo Implementation Workflow

When changing this repo:

1. Inspect existing patterns before editing. This is a pnpm monorepo using Node
   22+, ESM, strict TypeScript, tsup, Vitest, ESLint, Prettier, Changesets, and
   generated schema/docs checks.
2. Read current types in `packages/core/src/types/` and
   `packages/core/src/create-harness.ts` before changing public SDK examples or
   contracts.
3. Keep edits scoped to the layer involved: core contracts, policy, telemetry,
   adapter, CLI, GitHub Action, docs, examples, schemas, or tests.
4. Update tests and docs with behavior changes. Generated docs/schemas must be
   regenerated through repo scripts, not hand-edited blindly.
5. For CLI smoke commands in this repo, run `pnpm build` first because root
   `pnpm hk` executes `packages/cli/dist/index.js`.
6. For automated command discovery, use `pnpm --silent commands -- --json`
   instead of scraping terminal docs.

## Provider Caveats

- **Mock** is deterministic and credential-free. Use it for examples, tests, and
  contract validation. Do not infer real-provider behavior from mock support.
- **Claude** uses `@anthropic-ai/claude-agent-sdk`. It runs through a long-lived
  Claude subprocess and has provider-native local session state.
- **Cursor** uses `@cursor/sdk`. Local cancellation is currently unsupported in
  metaharness for `@cursor/sdk@1.0.17` because the SDK cancellation path can
  emit a late unhandled Connect cancellation rejection. Cloud and local
  capabilities must stay separate.
- **Codex** uses `@openai/codex-sdk`. SDK mode has fewer events than explicit
  app-server mode. App-server mode is version-sensitive; do not enable
  full-history persistence unless the capability supports it.

## Correct Artifacts

Runs write under `.harness/runs/<run-id>/`:

```text
events.ndjson
result.json
ledger.json
handoff.md
diff.patch
verification.log
provider/raw-events.ndjson
```

Normalized portable events belong in `events.ndjson`. Raw provider events belong
only in `provider/raw-events.ndjson` and only when raw capture is enabled.
`diff.patch` remains applyable and should be treated as sensitive.

## Patterns To Prefer

Use capability-driven branching:

```ts
const agent = harness.agent(selectedProvider);
const caps = await agent.capabilities();

if (caps.workspace.openPullRequest.supported) {
  // Enable PR controls.
}

if (!caps.lifecycle.cancel.supported) {
  // Hide or disable cancellation.
}
```

Use typed failures for unsupported operations:

```ts
import { UnsupportedCapabilityError } from "@metaharness/core";

try {
  await active.cancel();
} catch (error) {
  if (error instanceof UnsupportedCapabilityError) {
    // Report the capability limitation without pretending cancellation worked.
  } else {
    throw error;
  }
}
```

Use argv-style verification commands:

```ts
verification: ["pnpm test", "pnpm lint"];
```

Do not use shell composition for harness-owned verification:

```ts
verification: ["pnpm test && pnpm lint"]; // wrong
```

## Common Mistakes

Do not:

- Build a provider switchboard that hides unsupported capabilities.
- Branch on provider strings in app examples when a capability flag exists.
- Treat native provider sessions as transferable between providers.
- Store provider raw events in normalized event logs.
- Enable live provider tests in normal CI without explicit env gates and keys.
- Print API keys or store them in config examples.
- Claim policy compilation is a complete sandbox.
- Use shell string interpolation for harness-owned git, verification, or shell
  commands.
- Commit `.harness/` artifacts unless the user explicitly wants to preserve
  sensitive run material.
- Reverse-engineer provider auth, use subscription login flows, or proxy
  consumer accounts.

## Validation

For repo changes, run the narrowest useful check while iterating, then run:

```bash
pnpm check
```

For release, package, example, generated artifact, or broad handoff work, run:

```bash
pnpm ci:check
```

Live provider conformance is opt-in. Never run live provider tests unless the
matching gate variables and API keys are intentionally set.
