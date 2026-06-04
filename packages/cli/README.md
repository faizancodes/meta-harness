# @metaharness/cli

`hk` CLI for running, resuming, streaming, comparing, handing off, and auditing
coding-agent runs through metaharness.

## Install

```bash
pnpm add -D @metaharness/cli
```

The CLI package includes the metaharness adapter packages and the mock provider
for credential-free smoke tests. For real providers, install only the optional
SDK peers you plan to run.

Provider SDK packages are optional peers:

- Claude: `@anthropic-ai/claude-agent-sdk`
- Cursor: `@cursor/sdk`
- Codex: `@openai/codex-sdk`

## Use

Initialize and run the mock provider first:

```bash
pnpm exec hk init --providers mock
pnpm exec hk doctor --provider mock
pnpm exec hk run --provider mock --task "Summarize this workspace" --stream
```

Inspect recent run artifacts:

```bash
pnpm exec hk runs
pnpm exec hk stream latest
pnpm exec hk ledger show latest
pnpm exec hk ledger handoff latest
```

`hk run`, `hk resume`, and `hk handoff` human output prints a `next` section
with the run-specific artifact commands. Use `pnpm exec hk runs` to rediscover
older run ids later.

Compare providers with the same task:

```bash
pnpm exec hk compare \
  --providers mock \
  --task "Compare this workspace" \
  --verify "node --version"
```

Human compare output and `.harness/compares/<compare-id>/compare.md` include a
run id for each provider result. Use that run id when inspecting the result you
want to keep:

```bash
pnpm exec hk ledger show <run-id>
pnpm exec hk stream <run-id>
```

Handoff uses explicit run artifacts instead of hidden provider-native session
state:

```bash
pnpm exec hk runs
pnpm exec hk handoff \
  --from-run <run-id> \
  --to codex \
  --instruction "Finish verification and keep the patch minimal."
```

For machine-readable output through pnpm, use `--silent` so pnpm's script banner
does not contaminate JSON:

```bash
pnpm --silent exec hk run --provider mock --task "Summarize this workspace" --json
```

## Notes

- Requires Node.js 22 or newer.
- `--json` and `--stream` are mutually exclusive.
- CLI failures print stable stderr codes; see `docs/error-codes.md` in the
  metaharness repository.
- Raw provider events are disabled by default; enable `--raw-events` only when
  debugging adapter behavior.
- Run artifacts are written under `.harness/runs/<run-id>/` and may contain
  sensitive prompts, diffs, command summaries, and provider metadata.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
