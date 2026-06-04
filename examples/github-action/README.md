# github-action

Run metaharness from a GitHub Actions workflow. This directory contains
[issue-fixer.yml](issue-fixer.yml), an issue-labeled workflow that runs Codex
with Claude as a fallback and uploads `.harness/runs` artifacts.

Start with the generated mock workflow before adapting a provider-backed action:

```bash
WORKDIR="$(mktemp -d)"
pnpm hk --cwd "$WORKDIR" init --providers mock --ci github
cat "$WORKDIR/.github/workflows/metaharness.yml"
```

To adapt the issue-fixer example in a repository:

```bash
mkdir -p .github/workflows
cp examples/github-action/issue-fixer.yml .github/workflows/metaharness-issue-fixer.yml
```

Before enabling it:

- Replace `your-org/metaharness/packages/github-action@v0` with the published or
  checked-out action reference you intend to run.
- Prefer the generated `pnpm exec hk` workflow from `hk init --ci github` for
  provider-backed runs because it resolves optional provider SDK peers from the
  checked-out workspace.
- If you use the direct pinned JavaScript action reference in
  [issue-fixer.yml](issue-fixer.yml) with real providers, publish or check out
  an action distribution where those provider SDK peers are resolvable from the
  action path. Installing SDK peers only in the target workspace satisfies the
  generated CLI workflow, not an external pinned action's peer resolution.
- Store provider keys in GitHub Actions secrets, for example `OPENAI_API_KEY`
  and `ANTHROPIC_API_KEY`.
- Keep `pull_request_target` disabled unless the workflow performs explicit
  trust checks before invoking metaharness.
- Grant `contents: write` and `pull-requests: write` only when
  `open-pull-request` is enabled.

Validate provider setup locally before relying on CI:

```bash
pnpm hk doctor --provider mock
pnpm hk doctor --provider codex
pnpm hk doctor --provider claude
```

The workflow treats issue text as untrusted task input and leaves run artifacts
out of the generated branch. Upload `.harness/runs` as an artifact when you need
the ledger, patch, handoff prompt, verification log, and provider metadata for
review. Keep the upload step behind `if: always()` so failed runs and fallback
runs still preserve the artifacts needed for diagnosis.
