# Configuration

metaharness reads `metaharness.config.ts` from the workspace root by default.
Use `hk init` to generate a working mock-first config:

```bash
WORKDIR="$(mktemp -d)"
pnpm hk --cwd "$WORKDIR" init --providers mock
pnpm hk --cwd "$WORKDIR" doctor --provider mock
pnpm hk --cwd "$WORKDIR" run --provider mock --task "Summarize this workspace"
pnpm hk --cwd "$WORKDIR" ledger show latest
```

The generated config is intentionally plain ESM inside a `.ts` file so Node can
import it directly. Its default JSDoc type reference points at
`@metaharness/cli`, which is the package CLI-only users install. Keep runtime
imports out of the file unless the imported package is installed in the target
workspace. Use type-only imports or JSDoc comments when you want editor hints.
The generated comments explain the mock-first default provider, optional
provider SDK peers, sensitive `.harness` storage, raw-event debugging, and
policy allow-list review.

Keep the same `--cwd "$WORKDIR"` for the post-init doctor, run, and ledger
commands. The active `--cwd` is the base for config loading, policy paths,
storage, and the `latest` run alias.

## Choose A Config Shape

Use a file config when `hk`, a generated GitHub workflow, or a team-shared
workspace needs one reviewable source of truth:

```ts
/** @type {import("@metaharness/cli").HarnessConfig} */
export default {
  workspace: { cwd: process.cwd() },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" }
  }
};
```

That JSDoc type points at `@metaharness/cli` because CLI-only workspaces install
the CLI package and may not install `@metaharness/core` directly.

Use `defineConfig()` in SDK code when an application constructs the harness
itself and registers adapters in the same process:

```ts
import { createHarness, defineConfig } from "@metaharness/core";
import { MockAdapter } from "@metaharness/adapter-mock";

const config = defineConfig({
  workspace: { cwd: process.cwd() },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" }
  }
});

const harness = createHarness(config, [new MockAdapter()]);
```

Both shapes describe the same portable config contract. File configs are loaded
by the CLI and GitHub Action. SDK configs still need matching adapter instances
passed to `createHarness()`.

## Minimal Config

```ts
/** @type {import("@metaharness/cli").HarnessConfig} */
export default {
  workspace: {
    cwd: process.cwd()
  },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" }
  },
  policy: {
    file: "metaharness.policy.yaml"
  },
  storage: {
    rootDir: ".harness",
    redactSecrets: true
  },
  rawEvents: false
};
```

If the default `metaharness.config.ts` file does not exist, the CLI falls back
to a mock-only default config rooted at `--cwd`. When you pass `--config
<path>`, that file must exist and be a file; the path is resolved relative to
`--cwd`.

## Top-Level Fields

| Field             | Purpose                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `workspace`       | Required workspace settings. `cwd` is the root for tasks, relative files, storage, policy, and git capture. |
| `providers`       | Provider entries keyed by provider id: `mock`, `claude`, `cursor`, or `codex`.                              |
| `defaultProvider` | Provider used when a run or doctor command does not pass `--provider`.                                      |
| `policy`          | Policy file or inline policy object. Use a file for reviewable team policy.                                 |
| `storage`         | Run artifact location and redaction behavior.                                                               |
| `telemetry`       | Optional OpenTelemetry setup for CLI and SDK spans.                                                         |
| `rawEvents`       | Global default for provider raw-event capture. Keep this false unless debugging adapter behavior.           |

## Workspace

`workspace.cwd` should be an absolute path or a value resolved by the config at
runtime, usually `process.cwd()`.

Optional git settings tune workspace preparation and diff capture:

| Field                   | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `workspace.git.baseRef` | Base ref for diffs and compare workflows.                    |
| `branchPrefix`          | Prefix for generated branches.                               |
| `commitChanges`         | Ask metaharness workflows to commit changes where supported. |
| `createWorktree`        | Create isolated worktrees for workflows that support it.     |
| `requireClean`          | Fail before a run when the workspace is dirty.               |
| `worktreeRoot`          | Directory for generated worktrees.                           |

## Providers

Each provider entry must declare the same provider id as its key:

```ts
const config = {
  providers: {
    codex: {
      provider: "codex",
      apiKeyEnv: "OPENAI_API_KEY",
      runtime: "local"
    }
  }
};
```

Provider fields:

| Field       | Purpose                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `provider`  | Required provider id: `mock`, `claude`, `cursor`, or `codex`.                             |
| `model`     | Provider model name when the SDK exposes model selection.                                 |
| `runtime`   | `local`, `cloud`, or `self-hosted`; only use runtimes supported by the selected provider. |
| `apiKeyEnv` | Environment variable that contains the provider API key.                                  |
| `auth`      | Explicit auth values for controlled internal integrations. Avoid committing secrets.      |
| `native`    | Provider-specific escape hatch passed to the adapter. Keep usage documented and reviewed. |

Provider SDKs are optional peers. For SDK usage, install `@metaharness/core`,
the adapter package, and only the SDK packages for providers you actually run:

```bash
pnpm add @metaharness/core @metaharness/codex
pnpm add -D @openai/codex-sdk
```

CLI-only usage does not require separate adapter package installs because
`@metaharness/cli` depends on the metaharness adapters.

Use `hk doctor --provider <provider>` before live runs. Branch product behavior
on `ProviderCapabilities`; do not assume providers support the same lifecycle,
workspace, policy, or handoff features.

## Provider-Native MCP And Tools

metaharness does not define a top-level `mcp` config field and does not
reimplement MCP. Put provider-native MCP, tool, hook, or web-search settings
under the selected provider's `native` object, using the shape that provider SDK
expects.

Claude and Cursor adapters forward `mcpServers` from `providers.<id>.native`:

```ts
import { defineConfig } from "@metaharness/core";

const config = defineConfig({
  workspace: { cwd: process.cwd() },
  defaultProvider: "claude",
  providers: {
    claude: {
      provider: "claude",
      native: {
        mcpServers: {
          docs: {
            command: "node",
            args: ["./tools/docs-mcp.js"]
          }
        }
      }
    },
    cursor: {
      provider: "cursor",
      native: {
        mcpServers: {
          docs: {
            command: "node",
            args: ["./tools/docs-mcp.js"]
          }
        }
      }
    }
  }
});
```

Codex provider-native settings are forwarded through provider config records,
for example `native.config`, `native.codexOptions.config`, or
`native.appServer.threadParams.config` depending on the Codex runtime you are
using. Keep that object in the exact shape expected by the installed Codex SDK
or app-server mode.

Check capabilities before exposing product controls that depend on provider
tools:

```ts
const caps = await harness.agent(selectedProvider).capabilities();

if (caps.tools.mcp.supported) {
  // Enable MCP-dependent controls for this provider/runtime.
}
```

Policy, telemetry, redaction, event capture, ledgers, and handoff artifacts wrap
provider-native tool behavior. They do not turn provider-native MCP settings
into a portable metaharness tool protocol.

## Policy

Prefer a policy file:

```ts
const config = {
  policy: {
    file: "metaharness.policy.yaml"
  }
};
```

Inline policy is available for generated or embedded use:

```ts
const config = {
  policy: {
    inline: {
      commands: {
        default: "deny",
        allow: ["pnpm test"]
      }
    }
  }
};
```

Policy is defense in depth. It compiles provider-native hints plus
harness-observable guards, and does not become a complete sandbox guarantee.
Read [Policy](policy.md) and [Security](security.md) before treating policy as a
control boundary.

## Storage And Raw Events

By default, run artifacts live under `.harness/runs/<run-id>/`:

```text
events.ndjson
result.json
ledger.json
handoff.md
diff.patch
verification.log
provider/raw-events.ndjson
```

Keep `storage.redactSecrets` enabled. Treat `.harness/` as sensitive even with
redaction because prompts, transcripts, command summaries, diffs, and provider
metadata may still reveal private work.

Raw provider events are disabled by default. Enable them only in trusted
debugging environments:

```ts
const config = {
  rawEvents: true
};
```

Normalized events, result files, ledgers, and handoff prompts should remain
portable. Raw provider payloads belong in `provider/raw-events.ndjson`, not in
normal product logic.

## Telemetry

Telemetry is optional:

```ts
const config = {
  telemetry: {
    enabled: true,
    exporter: "otlp",
    serviceName: "metaharness"
  }
};
```

Supported exporters are `none`, `console`, and `otlp`. Environment variables
such as `METAHARNESS_OTEL_EXPORTER` and `METAHARNESS_OTEL_SERVICE_NAME` can
override defaults. The telemetry package also accepts the metaharness-specific
aliases `metaharness_OTEL_EXPORTER`, `metaharness_OTEL_SERVICE_NAME`, and
`metaharness_OTEL_SERVICE_VERSION`; when both forms are set, the
`metaharness_OTEL_*` value takes precedence. Invalid exporter values throw
`TELEMETRY_EXPORTER_UNSUPPORTED`. In-memory test telemetry can throw
`TELEMETRY_TRACER_PROVIDER_CONFLICT` when an OpenTelemetry global tracer
provider is already registered.

## Validate Config

Use the CLI doctor command for the provider you plan to run:

```bash
pnpm hk doctor --provider mock
pnpm hk doctor --provider codex
```

SDK and platform integrations can use the same config validator that backs the
CLI and GitHub Action diagnostics:

```ts
import { validateHarnessConfig } from "@metaharness/core";

const result = validateHarnessConfig({
  workspace: { cwd: process.cwd() },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" }
  }
});

if (!result.success) {
  throw new Error(result.diagnostics.join("\n"));
}
```

Config shape is also represented by
[`schemas/metaharness.config.schema.json`](../schemas/metaharness.config.schema.json).
When config types change, run:

```bash
pnpm schemas:generate
pnpm generated:check
```
