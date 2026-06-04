# Examples

Run examples from the repository root. From a fresh clone, start with
`corepack enable`, `pnpm install`, and `pnpm setup:doctor`. The setup doctor
builds the repo-local `hk` CLI before running the credential-free mock doctor.
Example scripts such as `pnpm examples:smoke` and `pnpm example:sdk` also build
what they need before running.

Use `pnpm examples:smoke` to verify the credential-free mock CLI and SDK example
paths in temporary workspaces.
Use `pnpm examples:docs:check` after adding or moving example directories so the
index and per-example READMEs stay discoverable.

## Pick An Example

| Example                                            | Use when you need to                                                        | Credentials                         | Start with                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| [quickstart](quickstart)                           | Learn the CLI flow, run the mock provider, and inspect run artifacts        | No external credentials             | `pnpm setup:doctor`                                          |
| [sdk-basic](sdk-basic)                             | Embed the harness API and stream mock-provider events from application code | No external credentials             | `pnpm example:sdk`                                           |
| [issue-to-patch](issue-to-patch)                   | Produce a patch artifact without auto-committing or opening a pull request  | Mock first; Codex optional          | `pnpm hk run --provider mock --task-file ...`                |
| [compare-providers](compare-providers)             | Run the same task across providers and compare ledgers, patches, and tests  | Mock first; live providers optional | `pnpm hk compare --providers mock --task-file ...`           |
| [handoff-claude-to-codex](handoff-claude-to-codex) | Continue work across providers using explicit ledger and diff artifacts     | Claude and Codex credentials        | `pnpm hk doctor --provider claude`                           |
| [github-action](github-action)                     | Adapt metaharness for CI or issue-driven GitHub workflows                   | GitHub secrets for live providers   | `pnpm hk --cwd "$WORKDIR" init --providers mock --ci github` |

## Principles

- Start with `mock` before using live providers.
- Install only the optional provider SDKs you need.
- Use `pnpm hk doctor --provider <provider>` before live runs. Use `--all` only
  when every provider is configured.
- Branch product logic on `ProviderCapabilities`.
- Treat `.harness/` artifacts as sensitive.
- Use handoff artifacts for cross-provider continuation, not hidden native
  session state.

## After A CLI Example

Most CLI examples write run artifacts under the active workspace's
`storage.rootDir`. Use `latest` for the newest run in that workspace, or copy an
explicit run id from `pnpm hk runs` when inspecting an older run:

```bash
pnpm hk runs
pnpm hk stream latest
pnpm hk ledger show latest
pnpm --silent hk ledger show latest --json
pnpm hk ledger handoff latest
pnpm artifacts:clean -- --dry-run
```

The ledger summary points at `events.ndjson`, `result.json`, `ledger.json`,
`handoff.md`, `diff.patch`, `verification.log`, and raw provider events when
raw capture was enabled. Treat `.harness/` as sensitive because these files can
contain prompts, transcripts, diffs, command summaries, and provider metadata.

## Useful Commands

```bash
pnpm hk doctor --provider mock
pnpm hk run --provider mock --task "Summarize this repo"
pnpm hk runs
pnpm hk stream latest
pnpm hk ledger show latest
pnpm example:sdk
pnpm examples:docs:check
pnpm examples:smoke
pnpm hk compare --providers mock --task "Compare smoke"
pnpm hk docs capabilities
```

Use `pnpm hk --cwd <workspace> init --providers mock` when you want to generate
config and policy files in a fresh workspace.
