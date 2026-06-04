# Handoff

Handoff moves work between providers using explicit artifacts:

- `ledger.json`
- `handoff.md`
- `diff.patch`
- optional verification output

It does not transfer hidden native provider session state.

## CLI

List recent source runs before choosing the handoff input:

```bash
pnpm hk runs
```

```bash
pnpm hk handoff --from-run <run-id> --to codex --instruction "Finish the tests"
```

Add `--apply-patch` to apply the source run patch before starting the target
provider:

```bash
pnpm hk handoff --from-run <run-id> --to claude --apply-patch
```

Human handoff output prints the source-to-destination provider pair, the
generated handoff prompt path, the destination run id, and a `next` section for
the destination run:

```bash
pnpm hk ledger show <run-id>
pnpm hk stream <run-id>
pnpm hk ledger handoff <run-id>
```

Use the destination run id from the `run <run-id> <status>` line for these
commands. Use `pnpm hk runs` when you need to rediscover source or destination
run ids later.

## SDK

```ts
const result = await harness.handoff({
  fromRunId: "run_...",
  toProvider: "cursor",
  instruction: "Review the diff and finish the failing verification",
  applyPatch: true,
  verification: ["pnpm test"]
});
```

## Prompt Contents

`handoff.md` includes:

- original task
- previous provider and model when known
- starting/ending commit and branch
- final summary
- latest plan
- commands already run
- files changed
- verification summaries
- patch path
- explicit portability boundary
- instructions for the next agent

## Patch Application

When `applyPatch` is true, core reads `fromLedger.diff.patchPath` and applies it
in the prepared workspace. Standard Git patches are applied with `git apply`.
For non-Git workspaces, metaharness text snapshot patches are applied directly.
Binary snapshot patches cannot be replayed and fail with a typed harness error.
If the source run has no patch, handoff fails with a typed harness error.

## Correct Mental Model

Handoff asks the next provider to continue from visible state. It is not resume.
Use provider-native resume only within the same provider adapter and native
session id.
