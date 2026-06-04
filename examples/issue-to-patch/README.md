# issue-to-patch

Use this workflow when the desired output is a patch artifact, not an automatic
commit or pull request.

Mock smoke:

```bash
pnpm hk run \
  --provider mock \
  --task-file examples/issue-to-patch/task.md \
  --verify "pnpm test" \
  --stream
```

Codex run, after installing `@openai/codex-sdk` and setting `OPENAI_API_KEY`:

```bash
pnpm hk run \
  --provider codex \
  --task-file examples/issue-to-patch/task.md \
  --verify "pnpm test" \
  --stream
```

Inspect the result:

```bash
pnpm hk runs
pnpm hk stream latest
pnpm hk ledger show latest
```

Automation should branch on capabilities before exposing pull request controls:

```ts
const caps = await harness.agent(selectedProvider).capabilities();

if (caps.workspace.openPullRequest.supported) {
  // Enable provider-native PR controls.
} else {
  // Keep the workflow patch-based.
}
```

Provider-native session state is not portable. Use `ledger.json`, `handoff.md`,
and `diff.patch` for continuation.
