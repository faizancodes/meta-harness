import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HarnessError } from "@metaharness/core";
import { parseProviderList } from "../provider-options.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import type { ProviderId } from "@metaharness/core";
import type { CliIO } from "../types.js";

export interface InitOptions {
  ci?: string;
  cwd: string;
  force?: boolean;
  providers?: string;
}

const supportedCiProviders = ["github"] as const;
type SupportedCiProvider = (typeof supportedCiProviders)[number];

const providerSetup = {
  claude: {
    env: "ANTHROPIC_API_KEY",
    package: "@anthropic-ai/claude-agent-sdk"
  },
  codex: {
    env: "OPENAI_API_KEY",
    package: "@openai/codex-sdk"
  },
  cursor: {
    env: "CURSOR_API_KEY",
    package: "@cursor/sdk"
  }
} as const satisfies Partial<
  Record<
    ProviderId,
    {
      env: string;
      package: string;
    }
  >
>;
const generatedConfigTypePackage = "@metaharness/cli";
const generatedConfigTypeKeyword = ["im", "port"].join("");

export async function initCommand(options: InitOptions, io: CliIO): Promise<void> {
  const providers = parseProviderList(options.providers, "--providers", {
    dedupe: true
  });
  const ci = parseCiProvider(options.ci);
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const targets = initTargets(cwd, ci);
  if (!options.force) {
    const existing = await existingTargets(targets);
    if (existing.length > 0) {
      throw new HarnessError(
        [
          "Refusing to overwrite existing metaharness files:",
          ...existing.map((target) => `  - ${target.label}`),
          "Run hk init --force to overwrite them intentionally."
        ].join("\n"),
        "INIT_TARGET_EXISTS"
      );
    }
  }

  await writeFile(resolve(cwd, "metaharness.config.ts"), renderConfig(providers), "utf8");
  await writeFile(resolve(cwd, "metaharness.policy.yaml"), defaultPolicyYaml(), "utf8");
  await mkdir(resolve(cwd, ".harness"), { recursive: true });
  await writeFile(resolve(cwd, ".harness", ".gitignore"), "*\n!.gitignore\n", "utf8");

  if (ci === "github") {
    await mkdir(resolve(cwd, ".github", "workflows"), { recursive: true });
    await writeFile(
      resolve(cwd, ".github", "workflows", "metaharness.yml"),
      renderGithubWorkflow(providers),
      "utf8"
    );
  }

  io.stdout.write(renderInitSuccess(providers, ci, cwd));
}

interface InitTarget {
  label: string;
  path: string;
}

function initTargets(cwd: string, ci: SupportedCiProvider | undefined): InitTarget[] {
  const targets: InitTarget[] = [
    {
      label: "metaharness.config.ts",
      path: resolve(cwd, "metaharness.config.ts")
    },
    {
      label: "metaharness.policy.yaml",
      path: resolve(cwd, "metaharness.policy.yaml")
    },
    {
      label: ".harness/.gitignore",
      path: resolve(cwd, ".harness", ".gitignore")
    }
  ];
  if (ci === "github") {
    targets.push({
      label: ".github/workflows/metaharness.yml",
      path: resolve(cwd, ".github", "workflows", "metaharness.yml")
    });
  }
  return targets;
}

async function existingTargets(targets: InitTarget[]): Promise<InitTarget[]> {
  const existing: InitTarget[] = [];
  for (const target of targets) {
    try {
      await access(target.path);
      existing.push(target);
    } catch {
      // Missing files are safe to create.
    }
  }
  return existing;
}

function parseCiProvider(value: string | undefined): SupportedCiProvider | undefined {
  if (!value) {
    return undefined;
  }
  if (supportedCiProviders.includes(value as SupportedCiProvider)) {
    return value as SupportedCiProvider;
  }
  throw new HarnessError(
    `Unsupported CI provider "${value}". Supported CI providers: ${supportedCiProviders.join(
      ", "
    )}.`,
    "CI_PROVIDER_UNSUPPORTED"
  );
}

function renderConfig(providers: ProviderId[]): string {
  const providerEntries = providers
    .map((provider) => `    "${provider}": { provider: "${provider}" }`)
    .join(",\n");
  const defaultProvider = providers[0] ?? "mock";
  return `/** @type {${generatedConfigTypeReference()}.HarnessConfig} */
export default {
  // All relative paths, storage, policy files, task files, and git capture start here.
  workspace: {
    cwd: process.cwd()
  },
  // Used when --provider is omitted. Keep mock first until real-provider auth is ready.
  defaultProvider: "${defaultProvider}",
  // Provider SDKs are optional peers. Install only the SDK peers for real providers you run.
  providers: {
${providerEntries}
  },
  // Keep policy in a reviewable file when teams share this workspace.
  policy: {
    file: "metaharness.policy.yaml"
  },
  // .harness can contain prompts, transcripts, diffs, and provider metadata; keep it ignored.
  storage: {
    rootDir: ".harness",
    redactSecrets: true
  },
  // Raw provider payloads are for trusted adapter debugging, not normal runs.
  rawEvents: false
};
`;
}

function generatedConfigTypeReference(): string {
  return `${generatedConfigTypeKeyword}("${generatedConfigTypePackage}")`;
}

function defaultPolicyYaml(): string {
  return `# Default policy is defense in depth, not a complete sandbox boundary.
# Review command, network, and writable-root allow lists before live provider runs.
version: 1
filesystem:
  mode: workspace-write
  writableRoots:
    - "."
  deny:
    - ".env"
    - ".env.local"
    - ".env.*.local"
    - ".env.development"
    - ".env.production"
    - ".env.test"
    - ".env.staging"
    - "**/id_rsa"
    - "**/.aws/**"
    - "**/.ssh/**"
    - "**/node_modules/**"
network:
  mode: deny-by-default
  allowHosts:
    - "registry.npmjs.org"
commands:
  # Add the exact test, lint, build, and verification commands this workspace needs.
  default: deny
  allow:
    - "pnpm test"
    - "pnpm lint"
    - "git diff"
    - "git diff *"
    - "git status"
    - "mock verify"
  deny:
    - "rm -rf *"
    - "curl * | sh"
    - "wget * | sh"
    - "printenv"
    - "env"
approvals:
  requireHumanFor:
    - outsideWorkspaceWrite
    - destructiveCommand
    - network
    - secretsAccess
secrets:
  redactEnv:
    - "OPENAI_API_KEY"
    - "ANTHROPIC_API_KEY"
    - "CURSOR_API_KEY"
    - "GITHUB_TOKEN"
  redactPatterns:
    - "sk-[A-Za-z0-9_-]{20,}"
    - "ghp_[A-Za-z0-9_]{20,}"
limits:
  maxTurns: 30
  maxDurationMs: 1800000
  maxFilesChanged: 25
  maxDiffBytes: 500000
providerOverrides: {}
`;
}

function renderInitSuccess(
  providers: ProviderId[],
  ci: SupportedCiProvider | undefined,
  cwd: string
): string {
  const defaultProvider = providers[0] ?? "mock";
  const quotedCwd = shellQuote(resolve(cwd));
  const created = [
    "metaharness.config.ts",
    "metaharness.policy.yaml",
    ".harness/.gitignore",
    ...(ci === "github" ? [".github/workflows/metaharness.yml"] : [])
  ];
  const lines = [
    "Created:",
    ...created.map((file) => `  - ${file}`),
    "",
    "Next:",
    `  pnpm exec hk --cwd ${quotedCwd} doctor --provider ${defaultProvider}`,
    `  pnpm exec hk --cwd ${quotedCwd} run --provider ${defaultProvider} --task "Summarize this workspace"`
  ];

  lines.push(
    "",
    "Inside this repository after pnpm build, use pnpm hk with the same --cwd."
  );

  const realProviders = providers.filter((provider) => provider !== "mock");
  if (realProviders.length > 0) {
    lines.push("", "Real provider setup:");
    for (const provider of realProviders) {
      const setup = providerSetup[provider];
      if (setup) {
        lines.push(
          `  ${provider}: install optional SDK peer ${setup.package} and set ${setup.env}`
        );
      }
    }
  }

  if (ci === "github") {
    lines.push(
      "",
      "GitHub Actions:",
      "  The generated workflow uses pnpm exec hk.",
      "  Add @metaharness/cli to the target workspace; it includes the adapter packages.",
      "  Install selected provider SDK optional peers for real providers."
    );
  }

  return `${lines.join("\n")}\n`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderGithubWorkflow(providers: ProviderId[]): string {
  const defaultProvider = providers[0] ?? "mock";
  const providerOptions = providers
    .map((provider) => `          - ${provider}`)
    .join("\n");
  return `name: metaharness
on:
  workflow_dispatch:
    inputs:
      provider:
        description: Provider to run
        type: choice
        default: ${defaultProvider}
        options:
${providerOptions}
      task:
        description: Agent task prompt
        type: string
        default: Summarize this repository and list any obvious follow-up work.
permissions:
  contents: read
jobs:
  run:
    runs-on: ubuntu-latest
    env:
      METAHARNESS_PROVIDER: \${{ inputs.provider }}
      METAHARNESS_TASK: \${{ inputs.task }}
      ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
      CURSOR_API_KEY: \${{ secrets.CURSOR_API_KEY }}
      OPENAI_API_KEY: \${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Verify metaharness CLI
        run: |
          if ! pnpm exec hk --help >/dev/null 2>&1; then
            echo "metaharness CLI is not installed in this workspace." >&2
            echo "Add @metaharness/cli as a dev dependency; it includes metaharness adapters." >&2
            echo "Install selected provider SDK optional peers for real providers." >&2
            exit 1
          fi
      - name: Write metaharness task
        run: |
          mkdir -p .harness
          printf '%s\\n' "$METAHARNESS_TASK" > .harness/task.md
      - name: Doctor
        run: pnpm exec hk doctor --provider "$METAHARNESS_PROVIDER"
      - name: Run metaharness
        run: pnpm exec hk run --provider "$METAHARNESS_PROVIDER" --task-file .harness/task.md --stream
      - name: Upload metaharness artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: metaharness-runs
          path: .harness/runs
`;
}
