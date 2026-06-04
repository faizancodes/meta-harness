import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { format } from "prettier";
import { describe, expect, it } from "vitest";
import {
  applyCursorCloudOptions,
  createProgram,
  docsCapabilitiesCommand,
  runCli,
  runCommand
} from "../src/index.js";
import type { HarnessConfig } from "@metaharness/core";
import type { CliIO } from "../src/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("@metaharness/cli", () => {
  it("prints top-level help with examples without failing", async () => {
    const io = memoryIO();

    await runCli(["node", "hk", "--help"], io);

    expect(io.stdoutText()).toContain("Usage: hk");
    expect(io.stdoutText()).toContain("Examples:");
    expect(io.stdoutText()).toContain("hk runs");
    expect(io.stdoutText()).toContain("hk doctor --provider mock");
    expect(io.stdoutText()).toContain("The CLI includes metaharness adapters");
    expect(io.stdoutText()).toContain("install only SDK peers for real providers");
    expect(io.stdoutText()).toContain("branch product logic on capabilities");
  });

  it("prints provider choices in setup and provider command help", async () => {
    const initIo = memoryIO();
    await runCli(["node", "hk", "init", "--help"], initIo);
    const initHelp = normalizeWhitespace(initIo.stdoutText());
    expect(initHelp).toContain("comma-separated providers: mock, claude, cursor, codex");
    expect(initHelp).toContain("hk init --providers mock");
    expect(initHelp).toContain("hk init --providers codex --ci github");
    expect(initHelp).toContain("Existing files are not overwritten unless --force");

    const doctorIo = memoryIO();
    await runCli(["node", "hk", "doctor", "--help"], doctorIo);
    const doctorHelp = normalizeWhitespace(doctorIo.stdoutText());
    expect(doctorHelp).toContain("provider id: mock, claude, cursor, codex");
    expect(doctorHelp).toContain("defaults to config.defaultProvider or mock");
  });

  it("prints policy and generated-doc helper examples", async () => {
    const docsIo = memoryIO();
    await runCli(["node", "hk", "docs", "capabilities", "--help"], docsIo);
    const docsHelp = normalizeWhitespace(docsIo.stdoutText());
    expect(docsHelp).toContain("hk docs capabilities");
    expect(docsHelp).toContain("hk docs capabilities --json");
    expect(docsHelp).toContain(
      "ProviderCapabilities matrix returned by installed adapters"
    );
    expect(docsHelp).toContain("branch on capability flags, not provider strings");

    const policyCheckIo = memoryIO();
    await runCli(["node", "hk", "policy", "check", "--help"], policyCheckIo);
    const policyCheckHelp = normalizeWhitespace(policyCheckIo.stdoutText());
    expect(policyCheckHelp).toContain("hk policy check --provider codex");
    expect(policyCheckHelp).toContain(
      "policy check --policy-file metaharness.policy.yaml --provider codex --json"
    );
    expect(policyCheckHelp).toContain("Validates policy syntax");
    expect(policyCheckHelp).toContain("provider-specific warnings");

    const policyCompileIo = memoryIO();
    await runCli(["node", "hk", "policy", "compile", "--help"], policyCompileIo);
    const policyCompileHelp = normalizeWhitespace(policyCompileIo.stdoutText());
    expect(policyCompileHelp).toContain("hk policy compile --provider codex");
    expect(policyCompileHelp).toContain("hk policy compile --provider codex --json");
    expect(policyCompileHelp).toContain("Requires --provider.");
    expect(policyCompileHelp).toContain("provider-native policy hints");
    expect(policyCompileHelp).toContain(
      "defense in depth, not a complete sandbox boundary"
    );
  });

  it("prints run and resume help with task, verification, and output-mode guidance", async () => {
    const runIo = memoryIO();
    await runCli(["node", "hk", "run", "--help"], runIo);
    const runHelp = normalizeWhitespace(runIo.stdoutText());
    expect(runHelp).toContain("defaults to config.defaultProvider or mock");
    expect(runHelp).toContain("task prompt file, resolved relative to --cwd");
    expect(runHelp).toContain("verification command; repeat for multiple commands");
    expect(runHelp).toContain("print JSON result; cannot be combined with --stream");
    expect(runHelp).toContain(
      "print human-readable events while active; cannot be combined with --json"
    );
    expect(runHelp).toContain(
      'hk run --provider mock --task "Summarize this repo" --stream'
    );
    expect(runHelp).toContain("hk ledger show latest");

    const resumeIo = memoryIO();
    await runCli(["node", "hk", "resume", "--help"], resumeIo);
    const resumeHelp = normalizeWhitespace(resumeIo.stdoutText());
    expect(resumeHelp).toContain("task prompt file, resolved relative to --cwd");
    expect(resumeHelp).toContain("print JSON result; cannot be combined with --stream");
    expect(resumeHelp).toContain("hk resume --provider codex --session");
    expect(resumeHelp).toContain("Use --run when continuing from a metaharness ledger.");
  });

  it("prints workflow examples for compare, handoff, and doctor help", async () => {
    const compareIo = memoryIO();
    await runCli(["node", "hk", "compare", "--help"], compareIo);
    const compareHelp = normalizeWhitespace(compareIo.stdoutText());
    expect(compareHelp).toContain("hk compare --providers mock,codex");
    expect(compareHelp).toContain(".harness/compares/<compare-id>/compare.md");
    expect(compareHelp).toContain("hk stream <run-id>");

    const handoffIo = memoryIO();
    await runCli(["node", "hk", "handoff", "--help"], handoffIo);
    const handoffHelp = normalizeWhitespace(handoffIo.stdoutText());
    expect(handoffHelp).toContain("hk handoff --from-run <run-id> --to codex");
    expect(handoffHelp).toContain("hk ledger handoff <run-id>");
    expect(handoffHelp).toContain(
      "It does not transfer hidden provider-native session state."
    );

    const doctorIo = memoryIO();
    await runCli(["node", "hk", "doctor", "--help"], doctorIo);
    const doctorHelp = normalizeWhitespace(doctorIo.stdoutText());
    expect(doctorHelp).toContain("hk doctor --provider mock");
    expect(doctorHelp).toContain("hk doctor --all");
    expect(doctorHelp).toContain("Use --provider for the provider you are about to run.");
  });

  it("prints artifact inspection examples for runs, stream, and ledger help", async () => {
    const runsIo = memoryIO();
    await runCli(["node", "hk", "runs", "--help"], runsIo);
    const runsHelp = normalizeWhitespace(runsIo.stdoutText());
    expect(runsHelp).toContain("hk runs --limit 5");
    expect(runsHelp).toContain("hk ledger show <run-id>");
    expect(runsHelp).toContain("Use latest when you want the most recent run");
    expect(runsHelp).toContain(
      "Artifact commands resolve runs from --cwd, --config, and storage.rootDir"
    );
    expect(runsHelp).toContain("same when using latest or inspecting a prior run");

    const streamIo = memoryIO();
    await runCli(["node", "hk", "stream", "--help"], streamIo);
    const streamHelp = normalizeWhitespace(streamIo.stdoutText());
    expect(streamHelp).toContain("hk stream latest");
    expect(streamHelp).toContain("hk stream <run-id> --raw");
    expect(streamHelp).toContain("Streams normalized portable events by default.");
    expect(streamHelp).toContain("Run lookup uses --cwd, --config, and storage.rootDir");
    expect(streamHelp).toContain("same when using latest or inspecting a prior run");

    const ledgerShowIo = memoryIO();
    await runCli(["node", "hk", "ledger", "show", "--help"], ledgerShowIo);
    const ledgerShowHelp = normalizeWhitespace(ledgerShowIo.stdoutText());
    expect(ledgerShowHelp).toContain("hk ledger show latest");
    expect(ledgerShowHelp).toContain("hk ledger show <run-id> --json");
    expect(ledgerShowHelp).toContain("changed files, and verification outcomes");
    expect(ledgerShowHelp).toContain(
      "Run lookup uses --cwd, --config, and storage.rootDir"
    );
    expect(ledgerShowHelp).toContain("same when using latest or inspecting a prior run");

    const ledgerExportIo = memoryIO();
    await runCli(["node", "hk", "ledger", "export", "--help"], ledgerExportIo);
    const ledgerExportHelp = normalizeWhitespace(ledgerExportIo.stdoutText());
    expect(ledgerExportHelp).toContain("hk ledger export latest");
    expect(ledgerExportHelp).toContain("hk ledger export <run-id> --out ledger.json");
    expect(ledgerExportHelp).toContain("portable SessionLedger JSON");
    expect(ledgerExportHelp).toContain("relative paths resolve from --cwd");
    expect(ledgerExportHelp).toContain(
      "Run lookup uses --cwd, --config, and storage.rootDir"
    );
    expect(ledgerExportHelp).toContain(
      "same when using latest or inspecting a prior run"
    );

    const ledgerHandoffIo = memoryIO();
    await runCli(["node", "hk", "ledger", "handoff", "--help"], ledgerHandoffIo);
    const ledgerHandoffHelp = normalizeWhitespace(ledgerHandoffIo.stdoutText());
    expect(ledgerHandoffHelp).toContain("hk ledger handoff latest");
    expect(ledgerHandoffHelp).toContain("hk ledger handoff <run-id> --out handoff.md");
    expect(ledgerHandoffHelp).toContain(
      "Renders the explicit handoff prompt from the run ledger."
    );
    expect(ledgerHandoffHelp).toContain("use hk handoff to start a destination run");
    expect(ledgerHandoffHelp).toContain(
      "Run lookup uses --cwd, --config, and storage.rootDir"
    );
    expect(ledgerHandoffHelp).toContain(
      "same when using latest or inspecting a prior run"
    );
  });

  it("hk init creates config, policy, harness ignore, and optional GitHub workflow", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-init-"));
    const io = memoryIO();
    const program = createProgram(io);

    await program.parseAsync(
      ["--cwd", cwd, "init", "--providers", "mock", "--ci", "github"],
      {
        from: "user"
      }
    );

    const config = await readFile(join(cwd, "metaharness.config.ts"), "utf8");
    expect(config).toContain('@type {import("@metaharness/cli").HarnessConfig}');
    expect(config).toContain(
      "All relative paths, storage, policy files, task files, and git capture start here."
    );
    expect(config).toContain("Keep mock first until real-provider auth is ready.");
    expect(config).toContain(
      "Provider SDKs are optional peers. Install only the SDK peers for real providers you run."
    );
    expect(config).toContain(
      ".harness can contain prompts, transcripts, diffs, and provider metadata"
    );
    expect(config).toContain(
      "Raw provider payloads are for trusted adapter debugging, not normal runs."
    );
    expect(config).toContain('defaultProvider: "mock"');
    expect(config).toContain('"mock": { provider: "mock" }');
    const policy = await readFile(join(cwd, "metaharness.policy.yaml"), "utf8");
    expect(policy).toContain(
      "Default policy is defense in depth, not a complete sandbox boundary."
    );
    expect(policy).toContain(
      "Review command, network, and writable-root allow lists before live provider runs."
    );
    expect(policy).toContain(
      "Add the exact test, lint, build, and verification commands this workspace needs."
    );
    expect(policy).toContain("version: 1");
    expect(await readFile(join(cwd, ".harness", ".gitignore"), "utf8")).toContain("*");
    const workflow = await readFile(
      join(cwd, ".github", "workflows", "metaharness.yml"),
      "utf8"
    );
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("METAHARNESS_TASK: ${{ inputs.task }}");
    expect(workflow).toContain("Verify metaharness CLI");
    expect(workflow).toContain("pnpm exec hk --help");
    expect(workflow).toContain(
      "Add @metaharness/cli as a dev dependency; it includes metaharness adapters."
    );
    expect(workflow).toContain(
      "Install selected provider SDK optional peers for real providers."
    );
    expect(workflow).toContain("printf '%s\\n' \"$METAHARNESS_TASK\"");
    expect(workflow).toContain('pnpm exec hk doctor --provider "$METAHARNESS_PROVIDER"');
    expect(workflow).toContain(
      'pnpm exec hk run --provider "$METAHARNESS_PROVIDER" --task-file .harness/task.md --stream'
    );
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(io.stdoutText()).toContain("Created:");
    expect(io.stdoutText()).toContain("  - metaharness.config.ts");
    expect(io.stdoutText()).toContain("  - metaharness.policy.yaml");
    expect(io.stdoutText()).toContain("  - .harness/.gitignore");
    expect(io.stdoutText()).toContain("  - .github/workflows/metaharness.yml");
    expect(io.stdoutText()).toContain("Next:");
    expect(io.stdoutText()).toContain(`pnpm exec hk --cwd ${cwd} doctor --provider mock`);
    expect(io.stdoutText()).toContain(
      `pnpm exec hk --cwd ${cwd} run --provider mock --task "Summarize this workspace"`
    );
    expect(io.stdoutText()).toContain(
      "Inside this repository after pnpm build, use pnpm hk with the same --cwd."
    );
    expect(io.stdoutText()).toContain("GitHub Actions:");
    expect(io.stdoutText()).toContain("The generated workflow uses pnpm exec hk.");
    expect(io.stdoutText()).toContain(
      "Add @metaharness/cli to the target workspace; it includes the adapter packages."
    );
    expect(io.stdoutText()).toContain(
      "Install selected provider SDK optional peers for real providers."
    );
    expect(io.stdoutText()).not.toContain("Real provider setup:");

    const runIo = memoryIO();
    await createProgram(runIo).parseAsync(
      ["--cwd", cwd, "run", "--provider", "mock", "--task", "init smoke"],
      {
        from: "user"
      }
    );
    expect(runIo.stdoutText()).toContain("success");
    expect(await hasRunArtifact(cwd, "events.ndjson")).toBe(true);
  });

  it("hk init refuses to overwrite generated files unless --force is passed", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-init-force-"));
    const configPath = join(cwd, "metaharness.config.ts");
    await writeFile(configPath, "export default { custom: true };\n", "utf8");

    await expect(
      createProgram(memoryIO()).parseAsync(["--cwd", cwd, "init"], {
        from: "user"
      })
    ).rejects.toThrow(/Refusing to overwrite existing metaharness files/);

    expect(await readFile(configPath, "utf8")).toBe("export default { custom: true };\n");
    expect(await exists(join(cwd, "metaharness.policy.yaml"))).toBe(false);

    const io = memoryIO();
    await createProgram(io).parseAsync(
      ["--cwd", cwd, "init", "--providers", "claude,codex", "--force"],
      {
        from: "user"
      }
    );

    const config = await readFile(configPath, "utf8");
    expect(config).toContain('defaultProvider: "claude"');
    expect(config).toContain('"claude": { provider: "claude" },\n');
    expect(config).toContain('"codex": { provider: "codex" }\n');
    expect(await readFile(join(cwd, "metaharness.policy.yaml"), "utf8")).toContain(
      "version: 1"
    );
    expect(io.stdoutText()).toContain("Real provider setup:");
    expect(io.stdoutText()).toContain(
      "claude: install optional SDK peer @anthropic-ai/claude-agent-sdk and set ANTHROPIC_API_KEY"
    );
    expect(io.stdoutText()).toContain(
      "codex: install optional SDK peer @openai/codex-sdk and set OPENAI_API_KEY"
    );
  });

  it("hk init reports missing or invalid workspace directories before writing files", async () => {
    const parent = await mkdtemp(join(tmpdir(), "metaharness-cli-init-cwd-"));
    const missingCwd = join(parent, "missing");

    await expect(
      createProgram(memoryIO()).parseAsync(["--cwd", missingCwd, "init"], {
        from: "user"
      })
    ).rejects.toThrow(
      new RegExp(
        `Workspace directory does not exist: ${escapeRegex(missingCwd)}.*Create it first or pass --cwd <existing-directory>.`,
        "s"
      )
    );

    expect(await exists(join(missingCwd, "metaharness.config.ts"))).toBe(false);

    const fileCwd = join(parent, "not-a-directory");
    await writeFile(fileCwd, "not a directory\n", "utf8");

    await expect(
      createProgram(memoryIO()).parseAsync(["--cwd", fileCwd, "init"], {
        from: "user"
      })
    ).rejects.toThrow(
      new RegExp(
        `Workspace path is not a directory: ${escapeRegex(fileCwd)}.*Pass --cwd <existing-directory>.`,
        "s"
      )
    );
  });

  it("hk init quotes workspace paths in follow-up commands", async () => {
    const parent = await mkdtemp(join(tmpdir(), "metaharness cli init parent "));
    const cwd = join(parent, "workspace with spaces");
    await mkdir(cwd);
    const io = memoryIO();

    await createProgram(io).parseAsync(["--cwd", cwd, "init", "--providers", "mock"], {
      from: "user"
    });

    expect(io.stdoutText()).toContain(
      `pnpm exec hk --cwd '${cwd}' doctor --provider mock`
    );
    expect(io.stdoutText()).toContain(
      `pnpm exec hk --cwd '${cwd}' run --provider mock --task "Summarize this workspace"`
    );
  });

  it("hk init rejects unsupported provider ids before writing files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-init-invalid-"));

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "init", "--providers", "openai"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      'Unsupported provider "openai". Supported providers: mock, claude, cursor, codex.'
    );

    expect(await exists(join(cwd, "metaharness.config.ts"))).toBe(false);
    expect(await exists(join(cwd, "metaharness.policy.yaml"))).toBe(false);
  });

  it("hk init rejects unsupported CI providers before writing files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-init-invalid-ci-"));

    await expect(
      createProgram(memoryIO()).parseAsync(["--cwd", cwd, "init", "--ci", "gitlab"], {
        from: "user"
      })
    ).rejects.toThrow(
      'Unsupported CI provider "gitlab". Supported CI providers: github.'
    );

    expect(await exists(join(cwd, "metaharness.config.ts"))).toBe(false);
    expect(await exists(join(cwd, ".github", "workflows", "metaharness.yml"))).toBe(
      false
    );
  });

  it("reports invalid workspace directories consistently across commands", async () => {
    const parent = await mkdtemp(join(tmpdir(), "metaharness-cli-cwd-"));
    const missingCwd = join(parent, "missing");

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", missingCwd, "run", "--provider", "mock", "--task", "bad cwd"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Workspace directory does not exist: ${escapeRegex(missingCwd)}.*Create it first or pass --cwd <existing-directory>.`,
        "s"
      )
    );

    const fileCwd = join(parent, "not-a-directory");
    await writeFile(fileCwd, "not a directory\n", "utf8");

    await expect(
      createProgram(memoryIO()).parseAsync(["--cwd", fileCwd, "doctor"], {
        from: "user"
      })
    ).rejects.toThrow(
      new RegExp(
        `Workspace path is not a directory: ${escapeRegex(fileCwd)}.*Pass --cwd <existing-directory>.`,
        "s"
      )
    );
  });

  it("runCli prints command failures without Node stack traces", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-error-"));
    await writeFile(
      join(cwd, "metaharness.config.ts"),
      "export default { custom: true };\n",
      "utf8"
    );
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(["node", "hk", "--cwd", cwd, "init"], io);

      expect(process.exitCode).toBe(1);
      expect(io.stderrText()).toContain(
        "error: INIT_TARGET_EXISTS: Refusing to overwrite existing metaharness files"
      );
      expect(io.stderrText()).toContain("Run hk init --force");
      expect(io.stderrText()).not.toContain(" at ");
      expect(io.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli prints typed workspace setup errors", async () => {
    const parent = await mkdtemp(join(tmpdir(), "metaharness-cli-workspace-error-"));
    const missingCwd = join(parent, "missing");
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(["node", "hk", "--cwd", missingCwd, "init"], io);

      expect(process.exitCode).toBe(1);
      expect(io.stderrText()).toContain(
        `error: WORKSPACE_NOT_FOUND: Workspace directory does not exist: ${missingCwd}`
      );
      expect(io.stderrText()).toContain(
        "Create it first or pass --cwd <existing-directory>."
      );
      expect(io.stderrText()).not.toContain(" at ");
      expect(io.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli prints typed config setup errors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-config-error-"));
    const configPath = join(cwd, "missing.config.ts");
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "--config",
          "missing.config.ts",
          "run",
          "--task",
          "missing config"
        ],
        io
      );

      expect(process.exitCode).toBe(1);
      expect(io.stderrText()).toContain(
        `error: CONFIG_NOT_FOUND: Config file not found: ${configPath}`
      );
      expect(io.stderrText()).toContain("--config is resolved relative to --cwd.");
      expect(io.stderrText()).not.toContain(" at ");
      expect(io.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli prints typed harness error codes for SDK-backed failures", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-harness-error-"));
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "resume",
          "--run",
          "missing-run",
          "--task",
          "resume missing run"
        ],
        io
      );

      expect(process.exitCode).toBe(1);
      expect(io.stderrText()).toContain(
        'error: RUN_ARTIFACT_NOT_FOUND: Run ledger not found for run "missing-run"'
      );
      expect(io.stderrText()).toContain(
        "Check the run id, configured workspace.cwd, and storage.rootDir."
      );
      expect(io.stderrText()).not.toContain(" at ");
      expect(io.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli prints typed artifact error codes for CLI artifact checks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-artifact-error-"));
    const emptyRunsIo = memoryIO();
    await createProgram(emptyRunsIo).parseAsync(["--cwd", cwd, "runs"], {
      from: "user"
    });
    expect(emptyRunsIo.stdoutText()).toContain(`runs ${join(cwd, ".harness", "runs")}`);
    expect(emptyRunsIo.stdoutText()).toContain("no runs found");

    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(["node", "hk", "--cwd", cwd, "stream", "missing-run"], io);

      expect(process.exitCode).toBe(1);
      expect(io.stderrText()).toContain(
        'error: RUN_ARTIFACT_NOT_FOUND: Run artifacts not found for run "missing-run"'
      );
      expect(io.stderrText()).toContain(
        "Check the run id, --cwd, --config, and storage.rootDir."
      );
      expect(io.stderrText()).not.toContain(" at ");
      expect(io.stdoutText()).toBe("");

      const latestIo = memoryIO();
      await runCli(["node", "hk", "--cwd", cwd, "ledger", "show", "latest"], latestIo);

      expect(process.exitCode).toBe(1);
      expect(latestIo.stderrText()).toContain(
        `error: RUN_ARTIFACT_NOT_FOUND: No run artifacts found under ${join(
          cwd,
          ".harness",
          "runs"
        )}.`
      );
      expect(latestIo.stderrText()).toContain(
        "Start a run first or pass an explicit run id to hk ledger show."
      );
      expect(latestIo.stderrText()).not.toContain(" at ");
      expect(latestIo.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli exits nonzero for reported JSON command failures", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-json-failure-"));
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "policy",
          "check",
          "--policy-file",
          "missing-policy.yaml",
          "--json"
        ],
        io
      );

      expect(process.exitCode).toBe(1);
      const diagnostics = JSON.parse(io.stdoutText()) as {
        errors: Array<{ code: string }>;
        ok: boolean;
      };
      expect(diagnostics.ok).toBe(false);
      expect(diagnostics.errors[0]?.code).toBe("POLICY_FILE_NOT_FOUND");
      expect(io.stderrText()).toContain(
        "error: POLICY_CHECK_FAILED: Policy check failed."
      );
      expect(io.stderrText()).not.toContain(" at ");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli prints typed policy diagnostics without stack traces", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-policy-error-"));
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "policy",
          "check",
          "--policy-file",
          "missing-policy.yaml"
        ],
        io
      );

      expect(process.exitCode).toBe(1);
      expect(io.stdoutText()).toContain("policy failed");
      expect(io.stderrText()).toContain("error: POLICY_FILE_NOT_FOUND: Policy file");
      expect(io.stderrText()).toContain(
        "error: POLICY_CHECK_FAILED: Policy check failed."
      );
      expect(io.stderrText()).not.toContain(" at ");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli exits nonzero for failed run results while preserving JSON stdout", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-run-json-failure-"));
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "run",
          "--provider",
          "mock",
          "--task",
          "failing verification",
          "--verify",
          "echo ok && false",
          "--json"
        ],
        io
      );

      expect(process.exitCode).toBe(1);
      const result = JSON.parse(io.stdoutText()) as {
        finalMessage?: string;
        status: string;
      };
      expect(result.status).toBe("failed");
      expect(result.finalMessage).toContain("Verification failed");
      expect(io.stderrText()).toContain("error: RUN_RESULT_FAILED: Run ");
      expect(io.stderrText()).toContain(" failed.");
      expect(io.stderrText()).not.toContain(" at ");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli exits nonzero for failed compare results while preserving JSON stdout", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-compare-json-failure-"));
    const io = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "compare",
          "--providers",
          "mock",
          "--task",
          "failing compare verification",
          "--verify",
          "echo ok && false",
          "--json"
        ],
        io
      );

      expect(process.exitCode).toBe(1);
      const result = JSON.parse(io.stdoutText()) as {
        summary: Array<{ status: string; testsPassed?: boolean }>;
      };
      expect(result.summary[0]).toEqual(
        expect.objectContaining({
          status: "failed",
          testsPassed: false
        })
      );
      expect(io.stderrText()).toContain("error: COMPARE_FAILED: Compare ");
      expect(io.stderrText()).toContain("verification failed");
      expect(io.stderrText()).not.toContain(" at ");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("reports invalid config files with actionable diagnostics", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-config-invalid-"));
    await writeFile(
      join(cwd, "metaharness.config.ts"),
      `export default {
  workspace: { cwd: process.cwd() },
  defaultProvider: "openai",
  providers: {
    openai: { provider: "openai" },
    mock: { provider: "codex", runtime: "remote" }
  }
};
`,
      "utf8"
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "run", "--task", "invalid config"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      /Unsupported defaultProvider "openai".*providers.openai is not supported.*providers.mock.provider must be "mock".*providers.mock.runtime/s
    );
  });

  it("uses the config default provider when run and doctor omit --provider", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-default-provider-"));
    await writeFile(
      join(cwd, "metaharness.config.ts"),
      `export default {
  workspace: { cwd: process.cwd() },
  defaultProvider: "cursor",
  providers: {
    cursor: { provider: "cursor", runtime: "local" }
  }
};
`,
      "utf8"
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        [
          "--cwd",
          cwd,
          "run",
          "--repo",
          "https://github.com/acme/repo",
          "--task",
          "default provider"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow("Pass --runtime cloud with Cursor cloud repository options.");

    await withoutEnv(["CURSOR_API_KEY"], async () => {
      const doctorJsonIo = memoryIO();
      await expect(
        createProgram(doctorJsonIo).parseAsync(["--cwd", cwd, "doctor", "--json"], {
          from: "user"
        })
      ).rejects.toThrow("Doctor checks failed.");

      const doctorJson = JSON.parse(doctorJsonIo.stdoutText()) as {
        checks: Array<{ category: string; name: string; status: string }>;
        providers: Array<{ provider: string }>;
      };
      expect(doctorJson.providers.map((entry) => entry.provider)).toEqual(["cursor"]);
      expect(doctorJson.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "cursor",
            name: "cursor adapter registered",
            status: "ok"
          }),
          expect.objectContaining({
            category: "cursor",
            name: "api key present",
            status: "fail"
          })
        ])
      );
      expect(doctorJson.checks).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            category: "claude",
            name: "api key present"
          }),
          expect.objectContaining({
            category: "codex",
            name: "api key present"
          })
        ])
      );
    });
  });

  it("reports explicit config path mistakes without falling back to defaults", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-config-path-"));
    const missingConfig = join(cwd, "missing.config.ts");

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "--config", "missing.config.ts", "run", "--task", "config path"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Config file not found: ${escapeRegex(missingConfig)}.*--config is resolved relative to --cwd.`,
        "s"
      )
    );

    const configDirectory = join(cwd, "config-directory");
    await mkdir(configDirectory);

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "--config", "config-directory", "run", "--task", "config path"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Config path is not a file: ${escapeRegex(configDirectory)}.*Pass --config <file> or omit --config to use metaharness.config.ts.`,
        "s"
      )
    );
  });

  it("doctor reports underlying diagnostic codes on failing checks", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-doctor-codes-"));
    const missingConfig = join(cwd, "missing.config.ts");

    const jsonIo = memoryIO();
    await expect(
      createProgram(jsonIo).parseAsync(
        [
          "--cwd",
          cwd,
          "--config",
          "missing.config.ts",
          "doctor",
          "--provider",
          "mock",
          "--json"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow("Doctor checks failed.");
    const jsonReport = JSON.parse(jsonIo.stdoutText()) as {
      checks: Array<{
        category: string;
        code?: string;
        message?: string;
        name: string;
        status: string;
      }>;
      ok: boolean;
    };
    expect(jsonReport.ok).toBe(false);
    expect(jsonReport.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "core",
          code: "CONFIG_NOT_FOUND",
          message: expect.stringContaining(`Config file not found: ${missingConfig}`),
          name: "config loaded",
          status: "fail"
        })
      ])
    );

    const humanIo = memoryIO();
    await expect(
      createProgram(humanIo).parseAsync(
        ["--cwd", cwd, "--config", "missing.config.ts", "doctor", "--provider", "mock"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow("Doctor checks failed.");
    expect(humanIo.stdoutText()).toContain(
      `fail config loaded - CONFIG_NOT_FOUND: Config file not found: ${missingConfig}`
    );
    expect(humanIo.stdoutText()).toContain("overall failed");

    await writeFile(
      join(cwd, "metaharness.config.ts"),
      `export default {
  workspace: { cwd: process.cwd() },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" }
  },
  policy: {
    inline: {
      version: 1,
      filesystem: { mode: "unsafe" },
      network: { mode: "deny-by-default" },
      commands: { default: "deny" }
    }
  }
};
`,
      "utf8"
    );

    const policyIo = memoryIO();
    await expect(
      createProgram(policyIo).parseAsync(
        ["--cwd", cwd, "doctor", "--provider", "mock", "--json"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow("Doctor checks failed.");
    const policyReport = JSON.parse(policyIo.stdoutText()) as {
      checks: Array<{
        category: string;
        code?: string;
        name: string;
        status: string;
      }>;
    };
    expect(policyReport.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "core",
          code: "POLICY_SCHEMA_ERROR",
          name: "policy valid",
          status: "fail"
        })
      ])
    );
  });

  it("reports config import failures with setup guidance", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-config-import-"));
    const configPath = join(cwd, "metaharness.config.ts");
    await writeFile(
      configPath,
      `import "missing-metaharness-config-package";

export default {
  workspace: { cwd: process.cwd() },
  defaultProvider: "mock",
  providers: {
    mock: { provider: "mock" }
  }
};
`,
      "utf8"
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "run", "--provider", "mock", "--task", "config import"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Failed to import config file "${escapeRegex(configPath)}":.*missing-metaharness-config-package.*Keep metaharness.config.ts as plain ESM`,
        "s"
      )
    );
  });

  it("run command uses the mock provider and writes run artifacts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-run-"));
    const io = memoryIO();

    const result = await runCommand(
      {
        cwd,
        provider: "mock",
        task: "test from cli",
        verify: ["node --version"]
      },
      io
    );

    expect(result.status).toBe("success");
    expect(await exists(result.eventLogPath ?? "")).toBe(true);
    expect(await exists(result.ledgerPath ?? "")).toBe(true);
    expect(await exists(result.handoffPath ?? "")).toBe(true);
    expect(await exists(result.patchPath ?? "")).toBe(true);
    expect(await exists(result.verificationLogPath ?? "")).toBe(true);
    expect(await readFile(result.verificationLogPath ?? "", "utf8")).toContain(
      "$ node --version"
    );
    const ledger = JSON.parse(await readFile(result.ledgerPath ?? "", "utf8")) as {
      verification: Array<{ command: string; exitCode?: number }>;
    };
    expect(ledger.verification).toEqual([
      expect.objectContaining({
        command: "node --version",
        exitCode: 0
      })
    ]);
    expect(io.stdoutText()).toContain(`run ${result.runId} success`);
    expect(io.stdoutText()).toContain("next");
    expect(io.stdoutText()).toContain(`hk ledger show ${result.runId}`);
    expect(io.stdoutText()).toContain(`hk stream ${result.runId}`);
    expect(io.stdoutText()).toContain(`hk ledger handoff ${result.runId}`);
    expect(io.stdoutText()).toContain("hk runs");
  });

  it("run, resume, and compare commands reject when results fail", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-result-failure-"));

    const runIo = memoryIO();
    await expect(
      createProgram(runIo).parseAsync(
        [
          "--cwd",
          cwd,
          "run",
          "--provider",
          "mock",
          "--task",
          "failing run verification",
          "--verify",
          "echo ok && false",
          "--json"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(/Run .* failed/);
    const failedRun = JSON.parse(runIo.stdoutText()) as {
      finalMessage?: string;
      status: string;
    };
    expect(failedRun.status).toBe("failed");
    expect(failedRun.finalMessage).toContain("Verification failed");

    const baseRun = await runCommand(
      {
        cwd,
        provider: "mock",
        task: "base run for failed resume"
      },
      memoryIO()
    );
    const resumeIo = memoryIO();
    await expect(
      createProgram(resumeIo).parseAsync(
        [
          "--cwd",
          cwd,
          "resume",
          "--run",
          baseRun.runId,
          "--task",
          "failing resume verification",
          "--verify",
          "echo ok && false",
          "--json"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(/Resume .* failed/);
    const failedResume = JSON.parse(resumeIo.stdoutText()) as {
      status: string;
    };
    expect(failedResume.status).toBe("failed");

    const compareIo = memoryIO();
    await expect(
      createProgram(compareIo).parseAsync(
        [
          "--cwd",
          cwd,
          "compare",
          "--providers",
          "mock",
          "--task",
          "failing compare verification",
          "--verify",
          "echo ok && false",
          "--json"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(/Compare .* failed/);
    const failedCompare = JSON.parse(compareIo.stdoutText()) as {
      summary: Array<{ status: string; testsPassed?: boolean }>;
    };
    expect(failedCompare.summary[0]).toEqual(
      expect.objectContaining({
        status: "failed",
        testsPassed: false
      })
    );
  });

  it("resolves task files relative to --cwd for run, compare, and resume", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-task-file-"));
    await writeFile(join(cwd, "run-task.md"), "task file run", "utf8");
    await writeFile(join(cwd, "compare-task.md"), "task file compare", "utf8");
    await writeFile(join(cwd, "resume-task.md"), "task file resume", "utf8");

    const runIo = memoryIO();
    await createProgram(runIo).parseAsync(
      ["--cwd", cwd, "run", "--provider", "mock", "--task-file", "run-task.md", "--json"],
      {
        from: "user"
      }
    );
    const runResult = JSON.parse(runIo.stdoutText()) as {
      finalMessage?: string;
      runId: string;
    };
    expect(runResult.finalMessage).toBe("Mock completed: task file run");

    const compareIo = memoryIO();
    await createProgram(compareIo).parseAsync(
      [
        "--cwd",
        cwd,
        "compare",
        "--providers",
        "mock",
        "--task-file",
        "compare-task.md",
        "--json"
      ],
      {
        from: "user"
      }
    );
    const compareResult = JSON.parse(compareIo.stdoutText()) as {
      runs: Array<{ finalMessage?: string }>;
    };
    expect(compareResult.runs[0]?.finalMessage).toBe("Mock completed: task file compare");

    const resumeIo = memoryIO();
    await createProgram(resumeIo).parseAsync(
      [
        "--cwd",
        cwd,
        "resume",
        "--run",
        runResult.runId,
        "--task-file",
        "resume-task.md",
        "--json"
      ],
      {
        from: "user"
      }
    );
    const resumeResult = JSON.parse(resumeIo.stdoutText()) as {
      finalMessage?: string;
    };
    expect(resumeResult.finalMessage).toBe("Mock completed: task file resume");
  });

  it("reports task-file path mistakes with actionable messages", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-task-file-errors-"));
    const missingTask = join(cwd, "missing-task.md");

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "run", "--provider", "mock", "--task-file", "missing-task.md"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Task file not found: ${escapeRegex(missingTask)}.*--task-file is resolved relative to --cwd.`,
        "s"
      )
    );

    const taskDirectory = join(cwd, "task-directory");
    await mkdir(taskDirectory);

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "compare", "--providers", "mock", "--task-file", "task-directory"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Task file is a directory: ${escapeRegex(taskDirectory)}.*Pass --task-file <file> or use --task for inline text.`,
        "s"
      )
    );

    const runCliIo = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "run",
          "--provider",
          "mock",
          "--task-file",
          "missing-task.md"
        ],
        runCliIo
      );

      expect(process.exitCode).toBe(1);
      expect(runCliIo.stderrText()).toContain(
        `error: TASK_FILE_NOT_FOUND: Task file not found: ${missingTask}`
      );
      expect(runCliIo.stderrText()).toContain(
        "--task-file is resolved relative to --cwd."
      );
      expect(runCliIo.stderrText()).not.toContain(" at ");
      expect(runCliIo.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("rejects blank task sources before starting a run", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-blank-task-"));

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "run", "--provider", "mock", "--task", "   "],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      "Task must contain non-whitespace text. Pass --task <text> or --task-file <file>."
    );

    const emptyTask = join(cwd, "empty-task.md");
    await writeFile(emptyTask, "\n \t\n", "utf8");

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "run", "--provider", "mock", "--task-file", "empty-task.md"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Task file is empty: ${escapeRegex(emptyTask)}.*non-whitespace prompt text`,
        "s"
      )
    );

    const runCliIo = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runCli(
        ["node", "hk", "--cwd", cwd, "run", "--provider", "mock", "--task", "   "],
        runCliIo
      );

      expect(process.exitCode).toBe(1);
      expect(runCliIo.stderrText()).toContain("error: TASK_MISSING:");
      expect(runCliIo.stderrText()).toContain("non-whitespace text");
      expect(runCliIo.stderrText()).not.toContain("RUN_TASK_MISSING");
      expect(runCliIo.stderrText()).not.toContain(" at ");
      expect(runCliIo.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("run --json and ledger show --json produce machine-readable output", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-json-"));
    const runIo = memoryIO();

    const result = await runCommand(
      {
        cwd,
        json: true,
        model: "mock-json-model",
        provider: "mock",
        rawEvents: true,
        runtime: "local",
        task: "json task"
      },
      runIo
    );
    const runJson = JSON.parse(runIo.stdoutText()) as { runId: string };
    expect(runJson.runId).toBe(result.runId);

    const ledgerIo = memoryIO();
    const program = createProgram(ledgerIo);
    await program.parseAsync(["--cwd", cwd, "ledger", "show", result.runId, "--json"], {
      from: "user"
    });
    const ledgerJson = JSON.parse(ledgerIo.stdoutText()) as {
      events: {
        rawEventLogPath?: string;
      };
      ledgerId: string;
    };
    expect(ledgerJson.ledgerId).toContain(result.runId);
    expect(ledgerJson).toEqual(
      expect.objectContaining({
        events: expect.objectContaining({
          rawEventLogPath: join(
            cwd,
            ".harness",
            "runs",
            result.runId,
            "provider",
            "raw-events.ndjson"
          )
        }),
        provider: expect.objectContaining({
          model: "mock-json-model",
          runtime: "local"
        })
      })
    );
  });

  it("rejects --json with --stream to keep stdout machine-readable", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-json-stream-"));

    await expect(
      createProgram(memoryIO()).parseAsync(
        [
          "--cwd",
          cwd,
          "run",
          "--provider",
          "mock",
          "--task",
          "json stream conflict",
          "--json",
          "--stream"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow("Use either --json or --stream, not both.");

    await expect(
      createProgram(memoryIO()).parseAsync(
        [
          "--cwd",
          cwd,
          "resume",
          "--provider",
          "mock",
          "--task",
          "resume json stream conflict",
          "--json",
          "--stream"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow("Use either --json or --stream, not both.");

    const runCliIo = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "run",
          "--provider",
          "mock",
          "--task",
          "json stream conflict",
          "--json",
          "--stream"
        ],
        runCliIo
      );

      expect(process.exitCode).toBe(1);
      expect(runCliIo.stderrText()).toContain(
        "error: OUTPUT_MODE_CONFLICT: Use either --json or --stream, not both."
      );
      expect(runCliIo.stderrText()).not.toContain(" at ");
      expect(runCliIo.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("maps Cursor cloud repository run options into native config", () => {
    const config: HarnessConfig = {
      defaultProvider: "cursor",
      providers: {
        cursor: {
          native: {
            cursor: {
              agentOptions: {
                name: "existing-cursor-agent"
              },
              cloud: {
                envVars: {
                  CI: "true"
                }
              }
            }
          },
          provider: "cursor",
          runtime: "cloud"
        }
      },
      workspace: {
        cwd: "/tmp/metaharness-cursor-cloud"
      }
    };

    const next = applyCursorCloudOptions(config, undefined, {
      autoCreatePr: true,
      prUrl: "https://github.com/acme/repo/pull/123",
      repo: "https://github.com/acme/repo",
      skipReviewerRequest: true,
      startingRef: "main",
      workOnCurrentBranch: true
    });

    expect(next).not.toBe(config);
    expect(next.providers?.cursor?.native).toEqual({
      cursor: {
        agentOptions: {
          name: "existing-cursor-agent"
        },
        cloud: {
          autoCreatePR: true,
          envVars: {
            CI: "true"
          },
          repos: [
            {
              prUrl: "https://github.com/acme/repo/pull/123",
              startingRef: "main",
              url: "https://github.com/acme/repo"
            }
          ],
          skipReviewerRequest: true,
          workOnCurrentBranch: true
        }
      }
    });
    expect(config.providers?.cursor?.native).toEqual({
      cursor: {
        agentOptions: {
          name: "existing-cursor-agent"
        },
        cloud: {
          envVars: {
            CI: "true"
          }
        }
      }
    });
  });

  it("rejects Cursor cloud repository options outside Cursor cloud runs", () => {
    const workspace = {
      cwd: "/tmp/metaharness-cursor-cloud-validation"
    };

    expect(() =>
      applyCursorCloudOptions(
        {
          defaultProvider: "mock",
          workspace
        },
        undefined,
        {
          repo: "https://github.com/acme/repo",
          runtime: "cloud"
        }
      )
    ).toThrow(/--provider cursor/);

    expect(() =>
      applyCursorCloudOptions(
        {
          defaultProvider: "cursor",
          providers: {
            cursor: {
              provider: "cursor",
              runtime: "local"
            }
          },
          workspace
        },
        undefined,
        {
          repo: "https://github.com/acme/repo"
        }
      )
    ).toThrow(/--runtime cloud/);

    expect(() =>
      applyCursorCloudOptions(
        {
          defaultProvider: "cursor",
          providers: {
            cursor: {
              provider: "cursor",
              runtime: "cloud"
            }
          },
          workspace
        },
        undefined,
        {
          startingRef: "main"
        }
      )
    ).toThrow(/--repo/);
  });

  it("stream, doctor, and policy check commands work against local artifacts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-commands-"));
    await writeFile(
      join(cwd, "metaharness.policy.yaml"),
      `version: 1
commands:
  default: deny
`,
      "utf8"
    );
    const result = await runCommand(
      {
        cwd,
        provider: "mock",
        task: "stream task",
        verify: ["node --version"]
      },
      memoryIO()
    );

    const streamIo = memoryIO();
    await createProgram(streamIo).parseAsync(["--cwd", cwd, "stream", result.runId], {
      from: "user"
    });
    expect(streamIo.stdoutText()).toContain("run started");
    expect(streamIo.stdoutText()).toContain("run completed");

    const latestResult = await runCommand(
      {
        cwd,
        provider: "mock",
        task: "latest artifact alias"
      },
      memoryIO()
    );
    await utimes(
      join(cwd, ".harness", "runs", result.runId),
      new Date(1_000),
      new Date(1_000)
    );
    await utimes(
      join(cwd, ".harness", "runs", latestResult.runId),
      new Date(2_000),
      new Date(2_000)
    );

    const latestStreamIo = memoryIO();
    await createProgram(latestStreamIo).parseAsync(["--cwd", cwd, "stream", "latest"], {
      from: "user"
    });
    expect(latestStreamIo.stdoutText()).toContain("run started");
    expect(latestStreamIo.stdoutText()).toContain("run completed");

    const latestLedgerIo = memoryIO();
    await createProgram(latestLedgerIo).parseAsync(
      ["--cwd", cwd, "ledger", "show", "latest"],
      {
        from: "user"
      }
    );
    expect(latestLedgerIo.stdoutText()).toContain(`run ${latestResult.runId}`);
    expect(latestLedgerIo.stdoutText()).toContain(
      "summary Mock completed: latest artifact alias"
    );
    expect(latestLedgerIo.stdoutText()).toContain("next");
    expect(latestLedgerIo.stdoutText()).toContain(`hk stream ${latestResult.runId}`);
    expect(latestLedgerIo.stdoutText()).toContain(
      `hk ledger export ${latestResult.runId} --out ledger.json`
    );
    expect(latestLedgerIo.stdoutText()).toContain(
      `hk ledger handoff ${latestResult.runId}`
    );
    expect(latestLedgerIo.stdoutText()).toContain("hk runs");

    const runsIo = memoryIO();
    await createProgram(runsIo).parseAsync(["--cwd", cwd, "runs"], {
      from: "user"
    });
    expect(runsIo.stdoutText()).toContain(`runs ${join(cwd, ".harness", "runs")}`);
    expect(runsIo.stdoutText()).toContain("run id\tstatus\tprovider\tupdated\tsummary");
    expect(runsIo.stdoutText()).toContain(latestResult.runId);
    expect(runsIo.stdoutText()).toContain(result.runId);
    expect(runsIo.stdoutText()).toContain("Mock completed: latest artifact alias");
    expect(runsIo.stdoutText()).toContain("next");
    expect(runsIo.stdoutText()).toContain("hk ledger show latest");
    expect(runsIo.stdoutText()).toContain("hk stream latest");
    expect(runsIo.stdoutText()).toContain("hk ledger handoff latest");
    expect(runsIo.stdoutText()).toContain("hk runs --json");

    const limitedRunsIo = memoryIO();
    await createProgram(limitedRunsIo).parseAsync(
      ["--cwd", cwd, "runs", "--limit", "1"],
      {
        from: "user"
      }
    );
    expect(limitedRunsIo.stdoutText()).toContain(latestResult.runId);
    expect(limitedRunsIo.stdoutText()).not.toContain(result.runId);

    const runsJsonIo = memoryIO();
    await createProgram(runsJsonIo).parseAsync(["--cwd", cwd, "runs", "--json"], {
      from: "user"
    });
    const runsJson = JSON.parse(runsJsonIo.stdoutText()) as {
      runs: Array<{ provider: string; runId: string; status: string; summary?: string }>;
      runsRoot: string;
    };
    expect(runsJson.runsRoot).toBe(join(cwd, ".harness", "runs"));
    expect(runsJson.runs[0]).toEqual(
      expect.objectContaining({
        provider: "mock",
        runId: latestResult.runId,
        status: "success",
        summary: "Mock completed: latest artifact alias"
      })
    );

    await expect(
      createProgram(memoryIO()).parseAsync(["--cwd", cwd, "stream", "missing-run"], {
        from: "user"
      })
    ).rejects.toThrow(
      new RegExp(
        `Run artifacts not found for run "missing-run": ${escapeRegex(
          join(cwd, ".harness", "runs", "missing-run")
        )}.*Check the run id, --cwd, --config, and storage.rootDir.`,
        "s"
      )
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "stream", result.runId, "--raw"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Raw event log not found for run "${escapeRegex(result.runId)}": ${escapeRegex(
          join(cwd, ".harness", "runs", result.runId, "provider", "raw-events.ndjson")
        )}.*Raw events are written only when --raw-events`,
        "s"
      )
    );

    const ledgerIo = memoryIO();
    await createProgram(ledgerIo).parseAsync(
      ["--cwd", cwd, "ledger", "show", result.runId],
      {
        from: "user"
      }
    );
    expect(ledgerIo.stdoutText()).toContain(`run ${result.runId}`);
    expect(ledgerIo.stdoutText()).toContain("status success");
    expect(ledgerIo.stdoutText()).toContain("provider mock");
    expect(ledgerIo.stdoutText()).toContain(`workspace ${cwd}`);
    expect(ledgerIo.stdoutText()).toContain("artifacts");
    expect(ledgerIo.stdoutText()).toContain(
      `events ${join(cwd, ".harness", "runs", result.runId, "events.ndjson")}`
    );
    expect(ledgerIo.stdoutText()).toContain(
      `result ${join(cwd, ".harness", "runs", result.runId, "result.json")}`
    );
    expect(ledgerIo.stdoutText()).toContain(
      `ledger ${join(cwd, ".harness", "runs", result.runId, "ledger.json")}`
    );
    expect(ledgerIo.stdoutText()).toContain(
      `handoff ${join(cwd, ".harness", "runs", result.runId, "handoff.md")}`
    );
    expect(ledgerIo.stdoutText()).toContain(
      `patch ${join(cwd, ".harness", "runs", result.runId, "diff.patch")}`
    );
    expect(ledgerIo.stdoutText()).toContain(
      `verification ${join(cwd, ".harness", "runs", result.runId, "verification.log")}`
    );
    expect(ledgerIo.stdoutText()).toContain("raw-events not captured");
    expect(ledgerIo.stdoutText()).toContain("changed 1");
    expect(ledgerIo.stdoutText()).toContain("create MOCK.md");
    expect(ledgerIo.stdoutText()).toContain("verification");
    expect(ledgerIo.stdoutText()).toContain("ok node --version");
    expect(ledgerIo.stdoutText()).toContain("events run.started:1");

    const ledgerExportIo = memoryIO();
    const ledgerOut = join(cwd, "exports", "ledger.json");
    await createProgram(ledgerExportIo).parseAsync(
      ["--cwd", cwd, "ledger", "export", result.runId, "--out", "exports/ledger.json"],
      {
        from: "user"
      }
    );
    expect(ledgerExportIo.stdoutText()).toContain(`wrote ${ledgerOut}`);
    const exportedLedger = JSON.parse(await readFile(ledgerOut, "utf8")) as {
      ledgerId: string;
    };
    expect(exportedLedger.ledgerId).toContain(result.runId);

    const handoffOutIo = memoryIO();
    const handoffOut = join(cwd, "exports", "handoff.md");
    await createProgram(handoffOutIo).parseAsync(
      ["--cwd", cwd, "ledger", "handoff", result.runId, "--out", "exports/handoff.md"],
      {
        from: "user"
      }
    );
    expect(handoffOutIo.stdoutText()).toContain(`wrote ${handoffOut}`);
    expect(await readFile(handoffOut, "utf8")).toContain(
      "does not transfer hidden provider-native session state"
    );

    const ledgerOutDirectoryIo = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "ledger",
          "export",
          result.runId,
          "--out",
          "exports"
        ],
        ledgerOutDirectoryIo
      );

      expect(process.exitCode).toBe(1);
      expect(ledgerOutDirectoryIo.stderrText()).toContain(
        `error: OUTPUT_PATH_INVALID: Output path is a directory: ${join(cwd, "exports")}`
      );
      expect(ledgerOutDirectoryIo.stderrText()).toContain(
        "Pass --out <file>, not a directory."
      );
      expect(ledgerOutDirectoryIo.stderrText()).not.toContain(" at ");
      expect(ledgerOutDirectoryIo.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "ledger", "show", "missing-run"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Run artifacts not found for run "missing-run": ${escapeRegex(
          join(cwd, ".harness", "runs", "missing-run")
        )}.*Check the run id, --cwd, --config, and storage.rootDir.`,
        "s"
      )
    );

    const doctorIo = memoryIO();
    await createProgram(doctorIo).parseAsync(
      ["--cwd", cwd, "doctor", "--provider", "mock"],
      {
        from: "user"
      }
    );
    expect(doctorIo.stdoutText()).toContain("metaharness Doctor");
    expect(doctorIo.stdoutText()).toContain("ok mock");
    expect(doctorIo.stdoutText()).toContain("\nnext\n");
    expect(doctorIo.stdoutText()).toContain(
      "run from a git workspace or disable clean-worktree requirements"
    );

    const doctorJsonIo = memoryIO();
    await createProgram(doctorJsonIo).parseAsync(
      ["--cwd", cwd, "doctor", "--provider", "mock", "--json"],
      {
        from: "user"
      }
    );
    const doctorJson = JSON.parse(doctorJsonIo.stdoutText()) as {
      checks: Array<{ category: string; name: string; status: string }>;
      ok: boolean;
    };
    expect(doctorJson.ok).toBe(true);
    expect(doctorJson.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "core",
          name: "node >=22",
          status: "ok"
        }),
        expect.objectContaining({
          category: "mock",
          name: "mock adapter registered",
          status: "ok"
        }),
        expect.objectContaining({
          category: "mock",
          name: "mock smoke",
          status: "ok"
        })
      ])
    );

    await withoutEnv(
      ["ANTHROPIC_API_KEY", "CURSOR_API_KEY", "OPENAI_API_KEY"],
      async () => {
        const doctorAllJsonIo = memoryIO();
        await expect(
          createProgram(doctorAllJsonIo).parseAsync(
            ["--cwd", cwd, "doctor", "--all", "--json"],
            {
              from: "user"
            }
          )
        ).rejects.toThrow("Doctor checks failed.");
        const doctorAllJson = JSON.parse(doctorAllJsonIo.stdoutText()) as {
          checks: Array<{ category: string; name: string; status: string }>;
          ok: boolean;
          providers: Array<{ provider: string; registered: boolean }>;
        };
        expect(doctorAllJson.ok).toBe(false);
        expect(doctorAllJson.providers.map((entry) => entry.provider)).toEqual([
          "mock",
          "claude",
          "cursor",
          "codex"
        ]);
        expect(doctorAllJson.checks).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              category: "claude",
              name: "claude adapter registered",
              status: "ok"
            }),
            expect.objectContaining({
              category: "cursor",
              name: "cursor adapter registered",
              status: "ok"
            }),
            expect.objectContaining({
              category: "codex",
              name: "codex adapter registered",
              status: "ok"
            }),
            expect.objectContaining({
              category: "codex",
              message: "@openai/codex-sdk",
              name: "provider SDK package installed",
              status: "fail"
            }),
            expect.objectContaining({
              category: "codex",
              name: "api key present",
              status: "fail"
            })
          ])
        );

        const doctorAllRunCliIo = memoryIO();
        const originalExitCode = process.exitCode;
        process.exitCode = undefined;
        try {
          await runCli(
            ["node", "hk", "--cwd", cwd, "doctor", "--all", "--json"],
            doctorAllRunCliIo
          );

          expect(process.exitCode).toBe(1);
          const doctorAllRunCliJson = JSON.parse(doctorAllRunCliIo.stdoutText()) as {
            ok: boolean;
          };
          expect(doctorAllRunCliJson.ok).toBe(false);
          expect(doctorAllRunCliIo.stderrText()).toContain(
            "error: DOCTOR_CHECKS_FAILED: Doctor checks failed."
          );
          expect(doctorAllRunCliIo.stderrText()).not.toContain(" at ");
        } finally {
          process.exitCode = originalExitCode;
        }

        const doctorAllIo = memoryIO();
        await expect(
          createProgram(doctorAllIo).parseAsync(["--cwd", cwd, "doctor", "--all"], {
            from: "user"
          })
        ).rejects.toThrow("Doctor checks failed.");
        expect(doctorAllIo.stdoutText()).toContain("overall failed");
        expect(doctorAllIo.stdoutText()).toContain("\nnext\n");
        expect(doctorAllIo.stdoutText()).toContain("set ANTHROPIC_API_KEY for claude");
        expect(doctorAllIo.stdoutText()).toContain("set CURSOR_API_KEY for cursor");
        expect(doctorAllIo.stdoutText()).toContain("set OPENAI_API_KEY for codex");
      }
    );

    const policyIo = memoryIO();
    await createProgram(policyIo).parseAsync(
      ["--cwd", cwd, "policy", "check", "--provider", "mock"],
      {
        from: "user"
      }
    );
    expect(policyIo.stdoutText()).toContain("policy ok");
    expect(policyIo.stdoutText()).toContain("PROVIDER_POLICY_MOCK_SYNTHETIC");

    const missingPolicyIo = memoryIO();
    const missingPolicyPath = join(cwd, "missing-policy.yaml");
    await expect(
      createProgram(missingPolicyIo).parseAsync(
        ["--cwd", cwd, "policy", "check", "--policy-file", "missing-policy.yaml"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow("Policy check failed.");
    expect(missingPolicyIo.stdoutText()).toContain("policy failed");
    expect(missingPolicyIo.stderrText()).toContain(
      `error: POLICY_FILE_NOT_FOUND: Policy file "${missingPolicyPath}" was not found.`
    );

    const compileIo = memoryIO();
    await createProgram(compileIo).parseAsync(
      ["--cwd", cwd, "policy", "compile", "--provider", "codex", "--json"],
      {
        from: "user"
      }
    );
    const compiled = JSON.parse(compileIo.stdoutText()) as {
      harnessGuards: Array<{ kind: string }>;
      nativeConfig: { sandbox?: string };
      provider: string;
    };
    expect(compiled.provider).toBe("codex");
    expect(compiled.nativeConfig.sandbox).toBe("workspace-write");
    expect(compiled.harnessGuards.map((guard) => guard.kind)).toContain("command-policy");
  });

  it("rejects unsupported provider ids consistently across commands", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-provider-"));
    await writeFile(
      join(cwd, "metaharness.policy.yaml"),
      `version: 1
commands:
  default: deny
`,
      "utf8"
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "run", "--provider", "openai", "--task", "bad provider"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      'Unsupported provider "openai". Supported providers: mock, claude, cursor, codex.'
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "doctor", "--provider", "openai"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      'Unsupported provider "openai". Supported providers: mock, claude, cursor, codex.'
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "policy", "compile", "--provider", "openai"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      'Unsupported provider "openai". Supported providers: mock, claude, cursor, codex.'
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "handoff", "--from-run", "missing-run", "--to", "openai"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      'Unsupported --to "openai". Supported providers: mock, claude, cursor, codex.'
    );

    const runCliIo = memoryIO();
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await runCli(
        [
          "node",
          "hk",
          "--cwd",
          cwd,
          "run",
          "--provider",
          "openai",
          "--task",
          "bad provider"
        ],
        runCliIo
      );

      expect(process.exitCode).toBe(1);
      expect(runCliIo.stderrText()).toContain(
        'error: PROVIDER_UNSUPPORTED: Unsupported provider "openai". Supported providers: mock, claude, cursor, codex.'
      );
      expect(runCliIo.stderrText()).not.toContain(" at ");
      expect(runCliIo.stdoutText()).toBe("");
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("runCli prints typed command option validation errors", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-option-errors-"));
    const cases: Array<{
      argv: string[];
      expected: string;
    }> = [
      {
        argv: [
          "node",
          "hk",
          "--cwd",
          cwd,
          "compare",
          "--providers",
          "mock",
          "--task",
          "invalid concurrency",
          "--max-concurrency",
          "0"
        ],
        expected:
          "error: NUMERIC_OPTION_INVALID: --max-concurrency must be a positive integer."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "runs", "--limit", "0"],
        expected: "error: NUMERIC_OPTION_INVALID: --limit must be a positive integer."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "init", "--ci", "gitlab"],
        expected:
          'error: CI_PROVIDER_UNSUPPORTED: Unsupported CI provider "gitlab". Supported CI providers: github.'
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "handoff", "--to", "mock"],
        expected: "error: HANDOFF_SOURCE_MISSING: Missing --from-run."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "handoff", "--from-run", "run_123"],
        expected: "error: HANDOFF_PROVIDER_MISSING: Missing --to provider."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "policy", "compile"],
        expected: "error: PROVIDER_MISSING: Missing --provider."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "stream"],
        expected:
          "error: RUN_ID_MISSING: Missing run id. Pass <run-id> or latest to hk stream."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "ledger", "show"],
        expected:
          "error: RUN_ID_MISSING: Missing run id. Pass <run-id> or latest to hk ledger show."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "ledger", "export"],
        expected:
          "error: RUN_ID_MISSING: Missing run id. Pass <run-id> or latest to hk ledger export."
      },
      {
        argv: ["node", "hk", "--cwd", cwd, "ledger", "handoff"],
        expected:
          "error: RUN_ID_MISSING: Missing run id. Pass <run-id> or latest to hk ledger handoff."
      },
      {
        argv: ["node", "hk", "nope"],
        expected: "error: CLI_USAGE_ERROR: unknown command 'nope'"
      },
      {
        argv: ["node", "hk", "run", "--bogus"],
        expected: "error: CLI_USAGE_ERROR: unknown option '--bogus'"
      },
      {
        argv: ["node", "hk", "run", "--provider"],
        expected:
          "error: CLI_USAGE_ERROR: option '--provider <provider>' argument missing"
      }
    ];

    const originalExitCode = process.exitCode;
    try {
      for (const item of cases) {
        const io = memoryIO();
        process.exitCode = undefined;

        await runCli(item.argv, io);

        expect(process.exitCode).toBe(1);
        expect(io.stderrText()).toContain(item.expected);
        expect(io.stderrText()).not.toContain(" at ");
        expect(io.stdoutText()).toBe("");
      }
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it("docs capabilities renders a provider capability matrix", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-docs-"));
    const io = memoryIO();

    await createProgram(io).parseAsync(["--cwd", cwd, "docs", "capabilities"], {
      from: "user"
    });

    expect(io.stdoutText()).toContain("# Provider Capabilities");
    expect(io.stdoutText()).toContain("workspace.openPullRequest");
    expect(io.stdoutText()).toContain("mock | claude | cursor | codex");
    expect(io.stdoutText()).toContain(
      "Application code should branch on capability flags"
    );
  });

  it("keeps docs/provider-capabilities.md in sync with generated adapter capabilities", async () => {
    const io = memoryIO();
    await docsCapabilitiesCommand(
      {
        cwd: repoRoot
      },
      io
    );
    const generated = await format(io.stdoutText(), {
      parser: "markdown"
    });
    const committed = await readFile(
      join(repoRoot, "docs", "provider-capabilities.md"),
      "utf8"
    );

    expect(committed).toBe(generated);
  });

  it("compare and handoff commands use mock provider artifacts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-compare-handoff-"));

    const compareIo = memoryIO();
    await createProgram(compareIo).parseAsync(
      [
        "--cwd",
        cwd,
        "compare",
        "--providers",
        "mock,mock",
        "--task",
        "compare from cli",
        "--verify",
        "node --version",
        "--max-concurrency",
        "2"
      ],
      {
        from: "user"
      }
    );
    expect(compareIo.stdoutText()).toContain("compare compare-");
    expect(compareIo.stdoutText()).toContain("provider\tstatus\tverify\trun id\tpatch");
    expect(compareIo.stdoutText()).toContain("mock\tsuccess\tverify:pass");
    const compareJsonPath = lineValue(compareIo.stdoutText(), "json ");
    const compareMarkdownPath = lineValue(compareIo.stdoutText(), "markdown ");
    expect(await exists(compareJsonPath)).toBe(true);
    expect(await exists(compareMarkdownPath)).toBe(true);
    const compareJson = JSON.parse(await readFile(compareJsonPath, "utf8")) as {
      runs: Array<{ runId: string }>;
    };
    expect(compareJson.runs).toHaveLength(2);
    expect(compareIo.stdoutText()).toContain(compareJson.runs[0]?.runId ?? "");
    expect(compareIo.stdoutText()).toContain("next");
    expect(compareIo.stdoutText()).toContain(`review markdown ${compareMarkdownPath}`);
    expect(compareIo.stdoutText()).toContain("hk ledger show <run-id>");
    expect(compareIo.stdoutText()).toContain("hk stream <run-id>");
    expect(compareIo.stdoutText()).toContain("hk runs");

    const handoffIo = memoryIO();
    await createProgram(handoffIo).parseAsync(
      [
        "--cwd",
        cwd,
        "handoff",
        "--from-run",
        compareJson.runs[0]?.runId ?? "",
        "--to",
        "mock",
        "--verify",
        "node --version",
        "--instruction",
        "continue carefully"
      ],
      {
        from: "user"
      }
    );
    expect(handoffIo.stdoutText()).toContain("handoff");
    expect(handoffIo.stdoutText()).toContain("run mock-run-");
    const handoffRunLine = lineValue(handoffIo.stdoutText(), "run ");
    const handoffRunId = handoffRunLine.split(/\s+/)[0] ?? "";
    expect(handoffIo.stdoutText()).toContain(`hk ledger show ${handoffRunId}`);
    expect(handoffIo.stdoutText()).toContain(`hk stream ${handoffRunId}`);
    expect(handoffIo.stdoutText()).toContain(`hk ledger handoff ${handoffRunId}`);
    expect(handoffIo.stdoutText()).toContain("hk runs");
    const handoffLedger = JSON.parse(
      await readFile(join(cwd, ".harness", "runs", handoffRunId, "ledger.json"), "utf8")
    ) as {
      verification: Array<{ command: string; exitCode?: number }>;
    };
    expect(handoffLedger.verification).toEqual([
      expect.objectContaining({
        command: "node --version",
        exitCode: 0
      })
    ]);
    const handoffPath = lineValue(handoffIo.stdoutText(), "prompt ");
    expect(await readFile(handoffPath, "utf8")).toContain(
      "does not transfer hidden provider-native session state"
    );
    expect(await readFile(handoffPath, "utf8")).toContain("continue carefully");

    await expect(
      createProgram(memoryIO()).parseAsync(
        ["--cwd", cwd, "handoff", "--from-run", "missing-run", "--to", "mock"],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Run ledger not found for run "missing-run": ${escapeRegex(
          join(cwd, ".harness", "runs", "missing-run", "ledger.json")
        )}.*Check the run id, configured workspace\\.cwd, and storage\\.rootDir\\.`,
        "s"
      )
    );
  });

  it("resume command can continue from a native session id or a prior run ledger", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-cli-resume-"));

    const sessionIo = memoryIO();
    await createProgram(sessionIo).parseAsync(
      [
        "--cwd",
        cwd,
        "resume",
        "--provider",
        "mock",
        "--model",
        "mock-resume-model",
        "--runtime",
        "self-hosted",
        "--raw-events",
        "--session",
        "native-session-123",
        "--task",
        "resume by native session",
        "--json"
      ],
      {
        from: "user"
      }
    );
    const sessionResult = JSON.parse(sessionIo.stdoutText()) as {
      nativeSessionId?: string;
      runId: string;
      status: string;
    };
    expect(sessionResult.status).toBe("success");
    expect(sessionResult.nativeSessionId).toBe("native-session-123");
    const sessionLedger = JSON.parse(
      await readFile(
        join(cwd, ".harness", "runs", sessionResult.runId, "ledger.json"),
        "utf8"
      )
    ) as {
      events: {
        rawEventLogPath?: string;
      };
      provider: {
        model?: string;
        runtime?: string;
      };
    };
    expect(sessionLedger.provider).toEqual(
      expect.objectContaining({
        model: "mock-resume-model",
        runtime: "self-hosted"
      })
    );
    expect(sessionLedger.events.rawEventLogPath).toBe(
      join(cwd, ".harness", "runs", sessionResult.runId, "provider", "raw-events.ndjson")
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        [
          "--cwd",
          cwd,
          "resume",
          "--run",
          "missing-run",
          "--task",
          "resume from missing run"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(
      new RegExp(
        `Run ledger not found for run "missing-run": ${escapeRegex(
          join(cwd, ".harness", "runs", "missing-run", "ledger.json")
        )}.*Check the run id, configured workspace\\.cwd, and storage\\.rootDir\\.`,
        "s"
      )
    );

    await expect(
      createProgram(memoryIO()).parseAsync(
        [
          "--cwd",
          cwd,
          "run",
          "--provider",
          "mock",
          "--runtime",
          "remote",
          "--task",
          "invalid runtime"
        ],
        {
          from: "user"
        }
      )
    ).rejects.toThrow(/Unsupported runtime/);

    const runIo = memoryIO();
    const baseResult = await runCommand(
      {
        cwd,
        provider: "mock",
        task: "base run for resume"
      },
      runIo
    );

    const resumeIo = memoryIO();
    await createProgram(resumeIo).parseAsync(
      [
        "--cwd",
        cwd,
        "resume",
        "--run",
        baseResult.runId,
        "--task",
        "resume from ledger",
        "--stream"
      ],
      {
        from: "user"
      }
    );
    expect(resumeIo.stdoutText()).toContain("resume mock-run-");
    expect(resumeIo.stdoutText()).toContain("success");
    expect(resumeIo.stdoutText()).toContain("run started");
    expect(resumeIo.stdoutText()).toContain("next");
    expect(resumeIo.stdoutText()).toContain("hk ledger show mock-run-");
    expect(resumeIo.stdoutText()).toContain("hk stream mock-run-");
    expect(resumeIo.stdoutText()).toContain("hk ledger handoff mock-run-");
    expect(resumeIo.stdoutText()).toContain("hk runs");
    expect(await hasRunArtifact(cwd, "ledger.json")).toBe(true);
  });
});

function memoryIO(): CliIO & {
  stderrText(): string;
  stdoutText(): string;
} {
  let stdout = "";
  let stderr = "";
  return {
    stderr: new Writable({
      write(chunk, _encoding, callback) {
        stderr += String(chunk);
        callback();
      }
    }),
    stderrText: () => stderr,
    stdout: new Writable({
      write(chunk, _encoding, callback) {
        stdout += String(chunk);
        callback();
      }
    }),
    stdoutText: () => stdout
  };
}

async function exists(path: string): Promise<boolean> {
  if (!path) {
    return false;
  }
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function hasRunArtifact(cwd: string, artifact: string): Promise<boolean> {
  const runsDir = join(cwd, ".harness", "runs");
  try {
    const runIds = await readdir(runsDir);
    for (const runId of runIds) {
      if (await exists(join(runsDir, runId, artifact))) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

function lineValue(output: string, prefix: string): string {
  const line = output.split("\n").find((candidate) => candidate.startsWith(prefix));
  if (!line) {
    throw new Error(`Missing output line with prefix ${prefix}`);
  }
  return line.slice(prefix.length).trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function withoutEnv<T>(names: string[], fn: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>(
    names.map((name) => [name, process.env[name]])
  );
  for (const name of names) {
    delete process.env[name];
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}
