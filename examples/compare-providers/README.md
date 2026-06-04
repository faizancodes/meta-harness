# compare-providers

Run the same task across providers and compare results from their ledgers,
patches, verification output, and usage metadata.

Start with the mock provider to verify local compare artifacts:

```bash
pnpm hk compare \
  --providers mock \
  --task-file examples/compare-providers/task.md \
  --verify "pnpm test"
```

Then switch to real providers after installing their optional SDK peers and
setting the matching API key environment variables:

```bash
pnpm hk doctor --provider claude
pnpm hk doctor --provider cursor
pnpm hk doctor --provider codex

pnpm hk compare \
  --providers claude,cursor,codex \
  --task-file examples/compare-providers/task.md \
  --verify "pnpm test" \
  --isolated-worktrees \
  --max-concurrency 2
```

The compare command writes:

```text
.harness/compares/<compare-id>/compare.json
.harness/compares/<compare-id>/compare.md
```

The human table and `compare.md` include a run id for each provider result. Use
the run id from the compare table when inspecting a specific provider result;
`latest` can point at the wrong run when a comparison starts multiple providers:

```bash
pnpm hk ledger show <run-id>
pnpm hk stream <run-id>
```

The `next` section in human output points at the markdown report and these
artifact commands.

It does not merge or auto-accept a provider output. Select a result by inspecting
the patch, ledger, and verification output.

The SDK and CLI run compare providers sequentially by default. Increase
`maxConcurrency` when the workspace strategy uses isolated worktrees or otherwise
keeps provider outputs separated.

When building product logic around compare results, treat provider IDs as run
inputs and use capability flags for behavior:

```ts
for (const provider of selectedProviders) {
  const caps = await harness.agent(provider).capabilities();

  if (caps.workspace.artifacts.supported) {
    // Show artifact links or download controls for this result.
  }
}
```
