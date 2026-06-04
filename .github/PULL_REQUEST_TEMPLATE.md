## Summary

-

## Validation

Run the narrow checks that match the changed files first, then the broader gate
when the change is ready for handoff. Use `pnpm commands` and
[docs/development.md#change-map](../docs/development.md#change-map) when the
right check is unclear.

- [ ] Targeted checks:
- [ ] `pnpm check`
- [ ] `pnpm ci:check` for broad, release, package, example, or handoff changes

## Change Notes

- [ ] Public API, CLI output, package behavior, or changelog-worthy docs changes
      include a Changeset.
- [ ] Generated docs or schemas were refreshed with `pnpm generated:write` when
      source-of-truth files changed.
- [ ] Examples and docs branch on `ProviderCapabilities` instead of provider
      names whenever a capability flag exists.
- [ ] Provider SDK packages remain optional peer dependencies and are loaded
      dynamically in adapters.
- [ ] Raw provider events remain disabled by default.
- [ ] Handoff or continuation docs do not claim provider-native hidden session
      state is portable.
- [ ] No `.harness/` artifacts, secrets, raw provider logs, private prompts, or
      private transcripts are committed or pasted into public logs.

## Live Provider Coverage

Live provider conformance is opt-in. Leave this blank unless you intentionally
ran provider-gated tests with matching API keys.

- Provider gates run:
- Relevant skipped gates:
