# handoff-claude-to-codex

This example starts with one provider and continues with another using the
metaharness ledger and patch.

It requires the Claude and Codex adapter SDK peers plus `ANTHROPIC_API_KEY` and
`OPENAI_API_KEY`. Run `pnpm hk doctor --provider claude` and
`pnpm hk doctor --provider codex` before starting the handoff.

Run the first provider:

```bash
pnpm hk run \
  --provider claude \
  --task-file examples/handoff-claude-to-codex/task.md
```

Continue with Codex:

```bash
pnpm hk runs

pnpm hk handoff \
  --from-run <run-id> \
  --to codex \
  --apply-patch \
  --verify "pnpm test" \
  --instruction "Finish the verification work and keep the patch minimal."
```

The second provider receives explicit context from:

- `.harness/runs/<run-id>/ledger.json`
- `.harness/runs/<run-id>/handoff.md`
- `.harness/runs/<run-id>/diff.patch`
- `.harness/runs/<run-id>/verification.log`

This is context transfer, not native session transfer. Hidden Claude session state
is not moved to Codex.
