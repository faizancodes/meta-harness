# Support

Use this guide to find the right support path for metaharness without leaking
private run data.

## Start Here

- Fresh clone, setup, or validation failure: run `pnpm setup:doctor`, then read
  [docs/troubleshooting.md](docs/troubleshooting.md).
- CLI usage: read [docs/cli.md](docs/cli.md) and run `pnpm hk --help`.
- SDK usage: read [docs/sdk.md](docs/sdk.md).
- Configuration, policy, storage, or telemetry: read
  [docs/configuration.md](docs/configuration.md), [docs/policy.md](docs/policy.md),
  and [docs/security.md](docs/security.md).
- Provider behavior: read [docs/provider-capabilities.md](docs/provider-capabilities.md)
  before assuming Claude, Cursor, Codex, and mock support the same operation.
- Error code from stderr, JSON, or a thrown error: read
  [docs/error-codes.md](docs/error-codes.md).

## Reporting Problems

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) for
reproducible failures. Include:

- the command, SDK API, or example you ran
- provider and provider SDK package version, if relevant
- Node and pnpm versions
- redacted error code, stderr, JSON output, or `pnpm setup:doctor` result
- the relevant `ProviderCapabilities` flag when behavior differs by provider

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
for SDK, CLI, adapter, policy, docs, or workflow proposals.

## Diagnostic Commands

For reproducible local or CLI failures, start with this credential-free bundle
and redact any private paths, prompts, transcripts, or provider output before
sharing it:

```bash
node --version
pnpm --version
pnpm setup:doctor
pnpm --silent hk doctor --provider mock --json
pnpm --silent commands -- --json
```

For provider-specific issues, rerun doctor for the selected provider after
`pnpm setup:doctor` has built the repo-local CLI:

```bash
pnpm --silent hk doctor --provider <provider> --json
```

For run artifact, `latest`, resume, handoff, or missing-run issues, include the
explicit run id when possible and collect the artifact summary from the same
workspace options used by the original run:

```bash
pnpm hk runs
pnpm hk ledger show <run-id>
pnpm hk stream <run-id>
```

If you used `--cwd`, `--config`, or a non-default `storage.rootDir`, include
those values and keep them the same for artifact inspection commands. Redact
private prompts, transcripts, command output, paths, diffs, and provider
metadata before sharing ledger or stream output.

## Sensitive Data

Do not paste API keys, tokens, private prompts, private transcripts, raw provider
logs, or sensitive `.harness/` artifacts into public issues, pull requests, or
logs. `.harness/` can contain prompts, transcripts, command summaries, diffs,
verification output, ledgers, and provider metadata.

For vulnerabilities or accidental secret disclosure, use [SECURITY.md](SECURITY.md)
instead of a public issue.
