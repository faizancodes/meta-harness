# metaharness docs

These docs describe the implemented metaharness SDK, CLI, provider adapters,
policy, storage, and operational workflows.

Use `harness.startRun()` for live event streaming, `wait()`, and `cancel()`. Use
`harness.run()` when a blocking run-to-result call is enough.

## Start Here

| Need                           | Read                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| Decode core terms              | [Glossary](glossary.md)                                                       |
| Understand the whole system    | [Architecture](architecture.md)                                               |
| Use the SDK in an app          | [SDK usage](sdk.md)                                                           |
| Use the CLI                    | [CLI reference](cli.md)                                                       |
| Configure metaharness          | [Configuration](configuration.md)                                             |
| Fix setup or run failures      | [Troubleshooting](troubleshooting.md)                                         |
| Look up an error code          | [Error codes](error-codes.md)                                                 |
| Get support                    | [Support](../SUPPORT.md)                                                      |
| Contribute to the repo         | [Development change map](development.md#change-map)                           |
| Run AI-assisted repo work      | [Agent instructions](../AGENTS.md)                                            |
| Implement or review an adapter | [Adapters](adapters.md) and [Provider capabilities](provider-capabilities.md) |
| Consume live events            | [Event model](event-model.md)                                                 |
| Continue work across providers | [Session ledger](ledger.md) and [Handoff](handoff.md)                         |
| Configure safety controls      | [Policy](policy.md) and [Security](security.md)                               |
| Handle sensitive disclosures   | [Security policy](../SECURITY.md)                                             |
| Validate provider behavior     | [Conformance](conformance.md)                                                 |
| Run in GitHub Actions          | [GitHub Action](github-action.md)                                             |
| Check source verification      | [Verified sources](verified-sources.md)                                       |

## First Hour Path

1. From the repo root, run `corepack enable`, `pnpm install`, and
   `pnpm setup:doctor`.
2. Run `pnpm commands` for the terminal-first command guide. Use
   `pnpm --silent commands -- --json` when automation needs the same command map.
3. Skim the [Glossary](glossary.md) if terms like adapter, ledger, handoff,
   portable event, or raw provider event are unfamiliar.
4. Run the mock quickstart in [examples/quickstart](../examples/quickstart), then
   inspect the newest artifacts with `pnpm hk runs`, `pnpm hk stream latest`,
   and `pnpm hk ledger show latest`.
5. Use the examples index's
   [After A CLI Example](../examples/#after-a-cli-example) workflow when you
   need JSON, handoff prompts, or artifact cleanup commands.
6. Read [CLI reference](cli.md) before wiring local or CI workflows.
7. Read [Configuration](configuration.md) before customizing providers,
   storage, policy, or telemetry.
8. Read [SDK usage](sdk.md) before embedding metaharness in application code.
9. Read [Provider capabilities](provider-capabilities.md) before adding UI or
   automation that depends on provider-specific behavior.
10. Read [Conformance](conformance.md) before changing adapters or event mapping.
11. Use [Troubleshooting](troubleshooting.md) when doctor, validation, provider
    setup, or CI output is unclear. Use [Error codes](error-codes.md) when you
    only have a code from stderr, JSON, or a thrown error.
12. Use the [Development change map](development.md#change-map) to find the
    right source files, tests, and public docs before changing the repo. The
    broader [Development](development.md) guide covers scripts, release workflow,
    generated docs, and live provider test gates.
13. Use [Agent instructions](../AGENTS.md) when an AI coding agent is making or
    reviewing repo changes.

Examples live under `examples/`:

- [quickstart](../examples/quickstart)
- [sdk-basic](../examples/sdk-basic)
- [issue-to-patch](../examples/issue-to-patch)
- [compare-providers](../examples/compare-providers)
- [handoff-claude-to-codex](../examples/handoff-claude-to-codex)
- [github-action](../examples/github-action)
