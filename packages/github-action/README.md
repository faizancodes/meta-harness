# @metaharness/github-action

GitHub Action wrapper for running metaharness coding-agent workflows in CI. The
package includes `action.yml`, the compiled action entrypoint, and exported
helpers for testing or custom wrappers.

## Install

Most workflows consume the action from a checked-out copy or a pinned GitHub
reference. For TypeScript wrappers and tests, install the package directly:

```bash
pnpm add @metaharness/github-action
```

## Inputs

Common inputs:

- `provider`: `claude`, `cursor`, `codex`, or `mock`
- `task` or `task-file`: non-whitespace prompt source. `task-file` is resolved
  relative to the action working directory.
- `verify`: one or more verification commands
- `policy-file`: defaults to `metaharness.policy.yaml`; an explicit path must
  exist
- `config-file`: defaults to `metaharness.config.ts`; an explicit path must
  exist, should be plain ESM, and is validated against the metaharness config
  schema
- `fallback-provider`: optional handoff target when the first run fails
- `open-pull-request`: create a branch and pull request from resulting changes

Provider SDK packages are optional peers:

- Claude: `@anthropic-ai/claude-agent-sdk`
- Cursor: `@cursor/sdk`
- Codex: `@openai/codex-sdk`

## Use From GitHub Actions

Pin the action to the GitHub repository path that contains `action.yml` and the
compiled `dist/` entrypoint. Replace `your-org/metaharness` and `v0` with your
published location and tag. This mock-first direct action path does not require
real provider SDK peers:

```yaml
jobs:
  agent:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v5
      - name: Run metaharness
        id: metaharness
        uses: your-org/metaharness/packages/github-action@v0
        with:
          provider: mock
          task: Summarize this repository.
      - name: Upload metaharness artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: metaharness-run
          path: .harness/runs
```

Prefer the generated `pnpm exec hk` workflow from `hk init --ci github` for
provider-backed runs. It resolves optional provider SDK peers from the checked-out
workspace where `pnpm install` ran. A pinned JavaScript action runs from the
action checkout; real provider peers must be resolvable from the action
distribution itself, so installing SDK peers only in the target repository does
not satisfy an external pinned action's peer resolution.

Provider-backed workflows should pass provider API keys through `env` and grant
write permissions only when `open-pull-request` is enabled.

## Outputs And Artifacts

Set an `id` on the action step when later steps need outputs:

```yaml
- name: Run metaharness
  id: metaharness
  uses: your-org/metaharness/packages/github-action@v0
  with:
    provider: mock
    task: Summarize this repository.
- name: Report run id
  if: always()
  run: echo "${{ steps.metaharness.outputs.run-id }}"
```

The action writes these outputs before failing the step with `ACTION_RUN_FAILED`
when the final run result is `failed` or `cancelled`:

- `run-id`
- `status`
- `final-message`
- `patch-file`
- `ledger-file`
- `handoff-file`
- `pull-request-url`
- `pull-request-number`
- `pull-request-branch`

When `fallback-provider` is set, outputs describe the final destination run
after fallback. Use `if: always()` on artifact upload so ledgers, patches,
handoff prompts, and verification logs are preserved for failed runs:

```yaml
- name: Upload metaharness artifacts
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: metaharness-run
    path: .harness/runs
```

Pull request outputs stay empty when the final run is non-success or when
`open-pull-request` is false.

## Use From TypeScript

```ts
import { executeAction } from "@metaharness/github-action";

const summary = await executeAction(
  {
    allowPullRequestTarget: false,
    configFile: "metaharness.config.ts",
    openPullRequest: false,
    policyFile: "metaharness.policy.yaml",
    provider: "mock",
    task: "Summarize this repository.",
    verify: []
  },
  {
    cwd: process.cwd()
  }
);

console.log(summary.result.status);
```

## Notes

- Requires Node.js 20 or newer when imported as a package; the workflow action
  uses the compiled Node 20 entrypoint declared in `action.yml`.
- The action writes outputs and then fails the step when the final run result is
  `failed` or `cancelled`. Pull request creation is skipped for non-success
  results. Failure codes are listed in `docs/error-codes.md` in the metaharness
  repository.
- The action refuses `pull_request_target` by default because that event can
  expose elevated secrets and write permissions to untrusted pull request
  content.
- Provider SDK packages remain optional peers. Install and configure only the
  providers used by a workflow.
- Never print API keys or GitHub tokens in prompts, verification logs, or action
  output.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
