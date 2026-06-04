import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MockAdapter } from "@metaharness/adapter-mock";
import { defaultCliConfig, loadConfig } from "../load-config.js";
import { createCliHarness } from "../harness.js";
import { parseProviderId } from "../provider-options.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import { HarnessError, gitDirty, isGitRepository } from "@metaharness/core";
import { parsePolicyFile, validatePolicy } from "@metaharness/policy";
import type { CliIO, GlobalOptions } from "../types.js";
import type { HarnessConfig, ProviderId } from "@metaharness/core";

export interface DoctorOptions extends GlobalOptions {
  all?: boolean;
  json?: boolean;
  provider?: ProviderId;
}

export type DoctorCheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  category: "core" | ProviderId;
  code?: string;
  name: string;
  status: DoctorCheckStatus;
  message?: string;
}

export interface CliDoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  providers: Array<{
    provider: ProviderId;
    registered: boolean;
  }>;
}

const providerPackages = {
  claude: "@anthropic-ai/claude-agent-sdk",
  codex: "@openai/codex-sdk",
  cursor: "@cursor/sdk",
  mock: undefined
} as const satisfies Record<ProviderId, string | undefined>;

const defaultApiKeyEnv = {
  claude: "ANTHROPIC_API_KEY",
  codex: "OPENAI_API_KEY",
  cursor: "CURSOR_API_KEY",
  mock: undefined
} as const satisfies Record<ProviderId, string | undefined>;

export async function doctorCommand(options: DoctorOptions, io: CliIO): Promise<void> {
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const checks: DoctorCheck[] = [];
  const { config } = await loadDoctorConfig(cwd, options, checks);
  const harness = createCliHarness(config);
  const provider = options.provider ? parseProviderId(options.provider) : undefined;
  const selectedProviders = selectedDoctorProviders({
    all: options.all,
    config,
    provider
  });
  const report = options.all
    ? await harness.doctor()
    : await harness.doctor({ provider: selectedProviders[0] ?? "mock" });

  checks.push(nodeCheck());
  await addInstallChecks(cwd, checks);
  await addPolicyCheck(cwd, config, checks);
  await addGitCheck(cwd, config, checks);
  await addRunDirectoryCheck(cwd, config, checks);
  await addMockSmokeCheck(cwd, checks);
  await addProviderChecks(cwd, config, selectedProviders, report.providers, checks);

  const cliReport: CliDoctorReport = {
    checks,
    ok: checks.every((check) => check.status !== "fail"),
    providers: report.providers
  };

  if (options.json) {
    io.stdout.write(`${JSON.stringify(cliReport, null, 2)}\n`);
    if (!cliReport.ok) {
      throwDoctorChecksFailed();
    }
    return;
  }

  io.stdout.write(renderCliDoctor(cliReport));
  if (!cliReport.ok) {
    throwDoctorChecksFailed();
  }
}

function throwDoctorChecksFailed(): never {
  throw new HarnessError("Doctor checks failed.", "DOCTOR_CHECKS_FAILED");
}

async function loadDoctorConfig(
  cwd: string,
  options: DoctorOptions,
  checks: DoctorCheck[]
): Promise<{ config: HarnessConfig }> {
  try {
    const config = await loadConfig(
      options.config ? { configPath: options.config, cwd } : { cwd }
    );
    checks.push({
      category: "core",
      message: options.config ?? "metaharness.config.ts or default config",
      name: "config loaded",
      status: "ok"
    });
    return { config };
  } catch (error) {
    const code = diagnosticCode(error);
    checks.push({
      category: "core",
      ...(code ? { code } : {}),
      message: error instanceof Error ? error.message : String(error),
      name: "config loaded",
      status: "fail"
    });
    return { config: defaultCliConfig(cwd) };
  }
}

function selectedDoctorProviders(input: {
  all?: boolean | undefined;
  config: HarnessConfig;
  provider?: ProviderId | undefined;
}): ProviderId[] {
  if (input.all) {
    return ["mock", "claude", "cursor", "codex"];
  }
  if (input.provider) {
    return [input.provider];
  }
  return [input.config.defaultProvider ?? "mock"];
}

function nodeCheck(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0] ?? "0");
  return {
    category: "core",
    message: process.version,
    name: "node >=22",
    status: major >= 22 ? "ok" : "fail"
  };
}

async function addInstallChecks(cwd: string, checks: DoctorCheck[]): Promise<void> {
  const packageJson = resolve(cwd, "package.json");
  const lockfile = resolve(cwd, "pnpm-lock.yaml");
  const nodeModules = resolve(cwd, "node_modules");
  const hasPackageJson = await exists(packageJson);
  const hasLockfile = await exists(lockfile);
  const hasNodeModules = await exists(nodeModules);

  checks.push({
    category: "core",
    message: hasPackageJson ? "package.json found" : "package.json not found",
    name: "package manifest",
    status: hasPackageJson ? "ok" : "warn"
  });
  checks.push({
    category: "core",
    message: hasLockfile
      ? "pnpm-lock.yaml found"
      : "pnpm-lock.yaml not found; install may still be valid for non-pnpm projects",
    name: "pnpm lockfile",
    status: hasLockfile ? "ok" : "warn"
  });
  checks.push({
    category: "core",
    message: hasNodeModules
      ? "node_modules found"
      : "node_modules not found; run pnpm install before live provider checks",
    name: "dependencies installed",
    status: hasNodeModules ? "ok" : "warn"
  });
}

async function addPolicyCheck(
  cwd: string,
  config: HarnessConfig,
  checks: DoctorCheck[]
): Promise<void> {
  if (config.policy?.inline) {
    const parsed = validatePolicy(config.policy.inline);
    const code = policyFailureCode(parsed.diagnostics);
    checks.push({
      category: "core",
      ...(code ? { code } : {}),
      message: parsed.diagnostics.errors.map((error) => error.message).join("; "),
      name: "policy valid",
      status: parsed.diagnostics.ok ? "ok" : "fail"
    });
    return;
  }

  const policyFile = resolve(cwd, config.policy?.file ?? "metaharness.policy.yaml");
  if (!(await exists(policyFile))) {
    checks.push({
      category: "core",
      message: `${policyFile} not found`,
      name: "policy valid",
      status: "warn"
    });
    return;
  }

  try {
    const parsed = await parsePolicyFile(policyFile);
    const code = policyFailureCode(parsed.diagnostics);
    checks.push({
      category: "core",
      ...(code ? { code } : {}),
      message: parsed.diagnostics.errors.map((error) => error.message).join("; "),
      name: "policy valid",
      status: parsed.diagnostics.ok ? "ok" : "fail"
    });
  } catch (error) {
    checks.push({
      category: "core",
      message: error instanceof Error ? error.message : String(error),
      name: "policy valid",
      status: "fail"
    });
  }
}

async function addGitCheck(
  cwd: string,
  config: HarnessConfig,
  checks: DoctorCheck[]
): Promise<void> {
  if (!(await isGitRepository(cwd))) {
    checks.push({
      category: "core",
      message: "workspace is not a git repository",
      name: "git status",
      status: config.workspace.git?.requireClean ? "fail" : "warn"
    });
    return;
  }

  const dirty = await gitDirty(cwd);
  checks.push({
    category: "core",
    message: dirty ? "workspace has uncommitted changes" : "workspace clean",
    name: "git status",
    status: dirty && config.workspace.git?.requireClean ? "fail" : "ok"
  });
}

async function addRunDirectoryCheck(
  cwd: string,
  config: HarnessConfig,
  checks: DoctorCheck[]
): Promise<void> {
  const root = resolve(cwd, config.storage?.rootDir ?? ".harness");
  try {
    await mkdir(root, { recursive: true });
    const dir = await mkdtemp(join(root, "doctor-"));
    await writeFile(resolve(dir, "probe.txt"), "ok\n", "utf8");
    await rm(dir, { force: true, recursive: true });
    checks.push({
      category: "core",
      message: root,
      name: "run directory writable",
      status: "ok"
    });
  } catch (error) {
    checks.push({
      category: "core",
      message: error instanceof Error ? error.message : String(error),
      name: "run directory writable",
      status: "fail"
    });
  }
}

async function addMockSmokeCheck(cwd: string, checks: DoctorCheck[]): Promise<void> {
  const ok = await smokeTestMock(cwd);
  checks.push({
    category: "mock",
    message: ok ? "mock capabilities loaded" : "mock capabilities failed",
    name: "mock smoke",
    status: ok ? "ok" : "fail"
  });
}

async function addProviderChecks(
  cwd: string,
  config: HarnessConfig,
  selectedProviders: ProviderId[],
  providers: CliDoctorReport["providers"],
  checks: DoctorCheck[]
): Promise<void> {
  for (const provider of selectedProviders) {
    const registered = providers.find((entry) => entry.provider === provider)?.registered;
    checks.push({
      category: provider,
      name: `${provider} adapter registered`,
      status: registered ? "ok" : "fail"
    });

    const packageName = providerPackages[provider];
    if (packageName) {
      checks.push({
        category: provider,
        message: packageName,
        name: "provider SDK package installed",
        status: packageInstalled(cwd, packageName) ? "ok" : "fail"
      });
    } else {
      checks.push({
        category: provider,
        name: "provider SDK package installed",
        status: "skip"
      });
    }

    const apiKeyEnv =
      config.providers?.[provider]?.apiKeyEnv ?? defaultApiKeyEnv[provider];
    if (apiKeyEnv) {
      checks.push({
        category: provider,
        message: apiKeyEnv,
        name: "api key present",
        status: hasProviderAuth(config, provider, apiKeyEnv) ? "ok" : "fail"
      });
    } else {
      checks.push({
        category: provider,
        name: "api key present",
        status: "skip"
      });
    }
  }
}

async function smokeTestMock(cwd: string): Promise<boolean> {
  try {
    const harness = createCliHarness({
      defaultProvider: "mock",
      providers: {
        mock: {
          provider: "mock"
        }
      },
      workspace: {
        cwd
      }
    });
    await harness.agent("mock").capabilities();
    await new MockAdapter().capabilities();
    return true;
  } catch {
    return false;
  }
}

function packageInstalled(cwd: string, packageName: string): boolean {
  try {
    const parentUrl = pathToFileURL(resolve(cwd, "package.json")).href;
    const resolveImport = import.meta.resolve as (
      specifier: string,
      parent?: string
    ) => string;
    resolveImport(packageName, parentUrl);
    return true;
  } catch {
    return false;
  }
}

function hasProviderAuth(
  config: HarnessConfig,
  provider: ProviderId,
  apiKeyEnv: string
): boolean {
  const providerConfig = config.providers?.[provider];
  return Boolean(
    providerConfig?.auth?.apiKey ??
    providerConfig?.auth?.[apiKeyEnv] ??
    process.env[apiKeyEnv]
  );
}

function renderCliDoctor(report: CliDoctorReport): string {
  const lines = ["metaharness Doctor"];
  const categories: Array<DoctorCheck["category"]> = [
    "core",
    "mock",
    "claude",
    "cursor",
    "codex"
  ];
  for (const category of categories) {
    const checks = report.checks.filter((check) => check.category === category);
    if (checks.length === 0) {
      continue;
    }
    lines.push(category);
    for (const check of checks) {
      lines.push(`  ${check.status} ${check.name}${formatDoctorMessage(check)}`);
    }
  }
  lines.push(`overall ${report.ok ? "ok" : "failed"}`);
  const nextSteps = doctorNextSteps(report.checks);
  if (nextSteps.length > 0) {
    lines.push("next");
    lines.push(...nextSteps.map((step) => `  ${step}`));
  }
  return `${lines.join("\n")}\n`;
}

function formatDoctorMessage(check: DoctorCheck): string {
  const message =
    check.code && check.message
      ? `${check.code}: ${check.message}`
      : (check.code ?? check.message);
  return message ? ` - ${message}` : "";
}

function diagnosticCode(error: unknown): string | undefined {
  return error instanceof HarnessError ? error.code : undefined;
}

function policyFailureCode(
  diagnostics: ReturnType<typeof validatePolicy>["diagnostics"]
): string | undefined {
  return diagnostics.ok ? undefined : diagnostics.errors[0]?.code;
}

function doctorNextSteps(checks: DoctorCheck[]): string[] {
  const steps = new Set<string>();
  for (const check of checks) {
    if (check.status !== "fail" && check.status !== "warn") {
      continue;
    }
    const category = check.category;
    if (category === "core") {
      steps.add(coreDoctorNextStep(check));
      continue;
    }
    if (check.name === "api key present" && check.message) {
      steps.add(
        `set ${check.message} for ${category}, or configure providers.${category}.apiKeyEnv`
      );
      continue;
    }
    if (check.name === "provider SDK package installed" && check.message) {
      steps.add(`install optional SDK peer ${check.message} for ${category}`);
      continue;
    }
    if (check.name.endsWith("adapter registered")) {
      steps.add(`ensure the ${category} adapter package is installed and registered`);
      continue;
    }
    steps.add(`inspect ${category} check "${check.name}"`);
  }
  return [...steps];
}

function coreDoctorNextStep(check: DoctorCheck): string {
  if (check.name === "node >=22") {
    return "install Node 22 or newer";
  }
  if (check.name === "config loaded") {
    return "fix metaharness.config.ts or pass --config <path>";
  }
  if (check.name === "package manifest") {
    return "run from the intended workspace root with package.json";
  }
  if (check.name === "pnpm lockfile") {
    return "run pnpm install when this is a pnpm workspace, or ignore for non-pnpm projects";
  }
  if (check.name === "dependencies installed") {
    return "run pnpm install before live provider checks";
  }
  if (check.name === "policy valid") {
    return "fix metaharness.policy.yaml or pass a valid configured policy file";
  }
  if (check.name === "git status") {
    return "run from a git workspace or disable clean-worktree requirements";
  }
  if (check.name === "run directory writable") {
    return "fix storage.rootDir permissions or choose another .harness directory";
  }
  return `inspect core check "${check.name}"`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
