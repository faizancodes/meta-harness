# Glossary

Use this glossary when reading metaharness docs, code, examples, or issue
reports. These terms describe the portable harness contract; provider-native
details still belong behind adapters and `ProviderCapabilities`.

| Term                  | Meaning                                                                                                                                                                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adapter               | Package code that maps one provider SDK into metaharness config, capabilities, events, run handles, and results. Adapter packages load provider SDKs dynamically and keep those SDKs as optional peers.                                   |
| Agent                 | The provider-specific handle returned by `harness.agent(provider)`. Use it to inspect capabilities, start runs, run to completion, resume where supported, or call supported lifecycle operations.                                        |
| Artifact              | A file, URL, branch, pull request, patch, screenshot, or provider output created by a run. Harness-owned run artifacts live under `.harness/`; treat them as sensitive.                                                                   |
| Compare               | A workflow that runs the same task across multiple providers, records each result, and writes compare output under `.harness/compares/<compare-id>/`. Compare does not make provider results interchangeable.                             |
| Config                | The `HarnessConfig` object or `metaharness.config.ts` file that defines workspace, providers, policy, storage, telemetry, and raw-event defaults.                                                                                         |
| Handoff               | Explicit continuation from one provider to another using the source `SessionLedger`, `handoff.md`, `diff.patch`, and verification output. Handoff does not transfer hidden provider-native session state.                                 |
| Harness               | The object returned by `createHarness(config, adapters)`. It registers available adapters and exposes provider-aware SDK operations such as `run`, `startRun`, `compare`, and `handoff`.                                                  |
| Ledger                | A portable `SessionLedger` summary of a run. It records the task, provider, events, result, artifact paths, changed files, verification outcomes, and handoff context.                                                                    |
| Live conformance      | Opt-in integration tests against real provider SDKs. They require matching API keys and gate variables such as `metaharness_TEST_CODEX=1`. Normal CI uses mock conformance.                                                               |
| Mock provider         | The deterministic in-process adapter used for credential-free tests, examples, setup checks, and documentation snippets. It verifies the portable contract without implying real provider behavior.                                       |
| Native options        | Provider-specific config passed through an adapter to the provider SDK. Keep native usage explicit, reviewed, and documented because it is not portable.                                                                                  |
| Policy                | Defense-in-depth controls that compile provider-native hints plus harness-observable command and redaction checks. Policy is not a complete sandbox boundary.                                                                             |
| Portable event        | A normalized `PortableRunEvent` emitted by adapters and persisted in `events.ndjson`. Product code should consume portable events before considering provider raw data.                                                                   |
| Provider              | A supported coding-agent runtime: `mock`, `claude`, `cursor`, or `codex`. Use provider ids for selection, but branch behavior on capabilities when a capability flag exists.                                                              |
| Provider capabilities | The `ProviderCapabilities` matrix returned by an agent. UI, examples, automation, and application code should use these flags to decide whether features such as streaming, cancel, cloud runtime, PR creation, or handoff are available. |
| Provider SDK          | The official package used by a real adapter, such as `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`, or `@openai/codex-sdk`. These remain optional peer dependencies for consumers.                                                      |
| Raw provider event    | Provider-native diagnostic data emitted as `provider.raw`. Raw events are disabled by default and, when enabled, are stored separately under `provider/raw-events.ndjson`.                                                                |
| Run                   | One provider execution of a task. A run writes `events.ndjson`, `result.json`, `ledger.json`, `handoff.md`, `diff.patch`, and `verification.log` under `.harness/runs/<run-id>/`.                                                         |
| Run result            | The terminal `RunResult` returned by `wait()` or `run()`. It records status, final message, artifact paths, optional diff, usage, and provider-native metadata where exposed.                                                             |
| Verification          | Commands configured for a run to prove the workspace after provider execution. Failed verification makes the metaharness result fail even if the provider session itself completed.                                                       |
| Workspace             | The directory a run operates in. It controls relative paths, config loading, policy files, storage, git capture, compare worktrees, and artifact lookup.                                                                                  |

## Where To Look Next

- Start with [Architecture](architecture.md) for the system layers and run flow.
- Use [SDK usage](sdk.md) for `createHarness()`, agents, runs, streaming, and
  results.
- Use [CLI reference](cli.md) for `hk` commands and artifact inspection.
- Use [Provider capabilities](provider-capabilities.md) before exposing
  provider-dependent controls.
- Use [Troubleshooting](troubleshooting.md) when setup, provider, CLI, artifact,
  or validation output is unclear.
