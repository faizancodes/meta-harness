# metaharness quickstart

Run the mock provider first; it does not require external credentials.
To smoke-test the credential-free example path end to end, run
`pnpm examples:smoke` from the repository root.

```bash
pnpm install
pnpm setup:doctor
pnpm hk run --provider mock --task "Summarize the repository"
```

To initialize a separate workspace, pass an explicit `--cwd`:

```bash
WORKDIR="$(mktemp -d)"
pnpm hk --cwd "$WORKDIR" init --providers mock
pnpm hk --cwd "$WORKDIR" run --provider mock --task "Summarize this workspace"
```

`hk init` will not overwrite existing generated files unless you pass `--force`.

Inspect the run artifacts:

```bash
pnpm hk runs
pnpm hk stream latest
pnpm hk ledger show latest
pnpm --silent hk ledger show latest --json
pnpm hk ledger handoff latest
```

In application code, branch on the selected provider's capabilities, not provider
names:

```ts
const caps = await harness.agent(selectedProvider).capabilities();

if (caps.workspace.openPullRequest.supported) {
  // Show a pull request workflow.
}

if (caps.policy.humanApprovals.supported) {
  // Enable approval controls.
}
```

Generate the provider matrix:

```bash
pnpm hk docs capabilities
```

Real provider adapters require their optional peer SDKs and provider-supported API
key environment variables. Native provider sessions are not portable; use the
metaharness ledger and diff for handoff.
