---
name: Bug report
about: Report reproducible metaharness behavior
title: "[Bug]: "
labels: bug
assignees: ""
---

## Before You File

- [ ] I checked [SUPPORT.md](../../SUPPORT.md).
- [ ] I checked [Troubleshooting](../../docs/troubleshooting.md) and
      [Error codes](../../docs/error-codes.md).
- [ ] This is not a vulnerability or secret disclosure. Use
      [SECURITY.md](../../SECURITY.md) for private security reporting.
- [ ] I removed API keys, tokens, private prompts, private transcripts, raw
      provider logs, and sensitive `.harness/` artifacts from this issue.

## What Happened

Describe the behavior you saw and the behavior you expected.

## Reproduction

Provide the smallest command, SDK snippet, config shape, or example directory
that reproduces the issue.

```bash

```

## Environment

- Node version:
- pnpm version:
- Package name and version:
- Provider: mock / Claude / Cursor / Codex
- Provider SDK package version, if relevant:
- CLI command or SDK API used:
- Live provider gate variables set, if any:

## Diagnostics

- Error code, if shown:
- Relevant redacted output:
- `pnpm setup:doctor` result:
- `pnpm --silent hk doctor --provider <provider> --json` result, if relevant:
- `pnpm --silent commands -- --json` result, if command discovery is unclear:
- Run id and `pnpm hk runs` output, if the issue involves run artifacts:
- Redacted `pnpm hk ledger show <run-id>` output, if relevant:
- Redacted `pnpm hk stream <run-id>` output, if relevant:
- `--cwd`, `--config`, and `storage.rootDir` used for the run and inspection:
- Focused validation command result:

## Provider Capability Notes

If the issue depends on streaming, cancellation, resume, MCP, PR creation, raw
events, policy, or handoff behavior, note the relevant `ProviderCapabilities`
flag and whether the behavior differs by provider.
