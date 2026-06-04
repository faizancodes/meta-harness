const args = normalizeArgs(process.argv.slice(2));
const wantsHelp = args.includes("--help") || args.includes("-h");
const wantsJson = args.includes("--json");
const unknownArgs = args.filter((arg) => !["--help", "-h", "--json"].includes(arg));

if (unknownArgs.length > 0) {
  console.error(`Unknown command-guide option: ${unknownArgs.join(", ")}`);
  console.error("Run pnpm commands -- --help for usage.");
  process.exit(1);
}

if (wantsHelp) {
  printUsage();
  process.exit(0);
}

const sections = [
  {
    title: "Start Here",
    commands: [
      ["pnpm setup:doctor", "fresh clone setup, build, and mock CLI doctor"],
      [
        'pnpm hk run --provider mock --task "Smoke test"',
        "create a credential-free run artifact"
      ],
      ["pnpm hk runs", "list recent run ids and confirm the newest run"],
      ["pnpm hk stream latest", "replay the newest run's portable event log"],
      ["pnpm hk ledger show latest", "inspect the newest run summary and artifacts"],
      ["pnpm commands", "show this guide"],
      ["pnpm hk --help", "show built CLI help"]
    ]
  },
  {
    title: "Validate",
    commands: [
      [
        "pnpm setup:check",
        "fast runtime, editor, agent-guidance, setup, and ignore-hygiene check"
      ],
      ["pnpm check", "normal full local validation"],
      ["pnpm ci:check", "handoff, PR, release, and broad-change validation"]
    ]
  },
  {
    title: "Iterate",
    commands: [
      ["pnpm test:project -- --help", "list Vitest projects and filter examples"],
      ["pnpm test:project -- cli", "run one Vitest project without building first"],
      ["pnpm --filter @metaharness/cli test", "run one package test script"],
      ["pnpm docs:check", "run docs and example drift checks"]
    ]
  },
  {
    title: "Learn By Example",
    commands: [
      ["pnpm example:sdk", "run the credential-free SDK mock example"],
      ["pnpm examples:smoke", "smoke-test credential-free CLI and SDK examples"],
      ["pnpm examples:docs:check", "verify example index and README discovery"]
    ]
  },
  {
    title: "Artifacts And Packaging",
    commands: [
      ["pnpm generated:write", "refresh generated provider docs and schemas"],
      ["pnpm generated:check", "verify generated artifacts are current"],
      ["pnpm artifacts:clean -- --dry-run", "inspect ignored local .harness artifacts"],
      ["pnpm clean -- --dry-run", "inspect all ignored local outputs"],
      ["pnpm package:check", "pack publishable packages and inspect tarballs"],
      ["pnpm consumer:smoke", "test packed packages in downstream projects"]
    ]
  },
  {
    title: "Format",
    commands: [
      ["pnpm format", "check Prettier formatting across the repo"],
      ["pnpm format:write", "format the repo with Prettier"],
      ["pnpm format:write docs/sdk.md", "format one path or a short changed-file list"]
    ]
  },
  {
    title: "Release Intent",
    commands: [
      ["pnpm changeset", "record public package version intent"],
      [
        "pnpm release:check",
        "verify release scripts, Changesets config, and workflow wiring"
      ]
    ]
  },
  {
    title: "Live Providers",
    commands: [
      ["pnpm test:live -- --help", "show provider gate and API-key matrix"],
      ["pnpm test:integration", "run mock-only integration conformance"]
    ]
  },
  {
    title: "Support",
    commands: [
      ["pnpm setup:doctor", "collect setup, build, and mock doctor diagnostics"],
      [
        "pnpm hk doctor --provider mock",
        "check one provider after build; swap provider id as needed"
      ],
      [
        "pnpm --silent hk doctor --provider mock --json",
        "emit parseable doctor diagnostics for issue reports"
      ]
    ]
  }
];

if (wantsJson) {
  console.log(
    JSON.stringify(
      {
        name: "metaharness command guide",
        sections: sections.map((section) => ({
          title: section.title,
          commands: section.commands.map(([command, description]) => ({
            command,
            description
          }))
        })),
        references: [
          "README.md#common-commands",
          "docs/development.md#root-scripts",
          "examples/README.md",
          "docs/troubleshooting.md",
          "docs/error-codes.md",
          "SUPPORT.md"
        ]
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log("metaharness command guide");
console.log("");
for (const section of sections) {
  console.log(section.title);
  const width = Math.max(...section.commands.map(([command]) => command.length));
  for (const [command, description] of section.commands) {
    console.log(`  ${command.padEnd(width)}  ${description}`);
  }
  console.log("");
}
console.log(
  "Read README.md#common-commands and docs/development.md#root-scripts for the full inventory."
);
console.log("Read examples/README.md for runnable CLI, SDK, handoff, and CI examples.");
console.log(
  "Read docs/troubleshooting.md for setup, provider, CLI, and artifact failures."
);
console.log(
  "Read docs/error-codes.md when stderr, JSON, or SDK errors include a stable code."
);
console.log("Read SUPPORT.md when commands are not enough to diagnose a problem.");

function normalizeArgs(rawArgs) {
  return rawArgs[0] === "--" ? rawArgs.slice(1) : rawArgs;
}

function printUsage() {
  console.log("Usage: pnpm commands");
  console.log("");
  console.log("Prints the short metaharness command guide for repo contributors.");
  console.log("Use --json for machine-readable command discovery.");
  console.log("");
  console.log("Examples:");
  console.log("  pnpm commands");
  console.log("  pnpm commands -- --help");
  console.log("  pnpm --silent commands -- --json");
}
