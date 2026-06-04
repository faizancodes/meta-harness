import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  AdapterNotFoundError,
  CommandPolicyViolationError,
  HarnessError,
  HarnessInputError,
  LedgerImportError,
  RunLimitExceededError
} from "./errors.js";
import type { CommandPolicyViolation, RunLimitViolation } from "./errors.js";
import { gitDirty, isGitRepository, runGit } from "./git.js";
import { createCompareId, createEventId, hashTask } from "./ids.js";
import { sessionLedgerSchema } from "./json-schemas.js";
import { FileRunStore } from "./run-store.js";
import { buildSessionLedger, renderHandoffMarkdown } from "./session-ledger.js";
import { spanAttributes, withHarnessSpan } from "./telemetry.js";
import { runVerificationCommands } from "./verification.js";
import type { VerificationResult } from "./verification.js";
import { FileWorkspaceManager } from "./workspace-manager.js";
import type {
  CapabilityProbeInput,
  CodingAgentAdapter,
  ProviderId
} from "./types/adapter.js";
import type { ProviderCapabilities } from "./types/capabilities.js";
import type { HarnessConfig } from "./types/config.js";
import type { SessionLedger } from "./types/ledger.js";
import type {
  HarnessPolicyApi,
  HarnessPolicyConfig,
  PolicyCheckInput,
  PolicyCheckResult,
  PolicyDiagnostic
} from "./types/policy.js";
import type { RunHandle, RunInput, RunLimits } from "./types/run.js";
import type { RunResult } from "./types/result.js";
import type {
  ResumeSessionConfig,
  SessionHandle,
  StartSessionConfig
} from "./types/session.js";
import type { PortableRunEvent } from "./types/events.js";
import type { PreparedWorkspace, WorkspaceConfig } from "./types/workspace.js";

interface RunWithAdapterOptions {
  onEvent?: (event: PortableRunEvent) => Promise<void> | void;
  onRunStarted?: (run: RunHandle) => Promise<void> | void;
  verification?: string[];
}

export interface Harness {
  agent(provider?: ProviderId): HarnessAgent;
  policy: HarnessPolicyApi;
  startRun(input: RunInput & { provider?: ProviderId }): Promise<ActiveRun>;
  run(input: RunInput & { provider?: ProviderId }): Promise<RunResult>;
  startResume(input: ResumeRunInput & { provider?: ProviderId }): Promise<ActiveRun>;
  resume(input: ResumeRunInput & { provider?: ProviderId }): Promise<RunResult>;
  compare(input: CompareInput): Promise<CompareResult>;
  handoff(input: HandoffInput): Promise<HandoffResult>;
  exportLedger(runId: string): Promise<SessionLedger>;
  importLedger(pathOrLedger: string | SessionLedger): Promise<SessionLedger>;
  doctor(input?: DoctorInput): Promise<DoctorReport>;
  dispose(): Promise<void>;
}

export interface HarnessAgent {
  provider: ProviderId;
  capabilities(): Promise<ProviderCapabilities>;
  startSession(config?: Partial<StartSessionConfig>): Promise<SessionHandle>;
  resumeSession(
    config: Partial<ResumeSessionConfig> & { nativeSessionId?: string }
  ): Promise<SessionHandle>;
  startRun(input: RunInput): Promise<ActiveRun>;
  run(input: RunInput): Promise<RunResult>;
  startResumeRun(input: ResumeRunInput): Promise<ActiveRun>;
  resumeRun(input: ResumeRunInput): Promise<RunResult>;
}

export interface ActiveRun {
  provider: ProviderId;
  runId: string;
  sessionId: string;
  nativeRunId?: string;
  nativeSessionId?: string;
  startedAt: string;
  events(): AsyncIterable<PortableRunEvent>;
  wait(): Promise<RunResult>;
  cancel(): Promise<void>;
}

export interface ResumeRunInput extends RunInput {
  ledger?: SessionLedger;
  nativeSessionId?: string;
  sessionId?: string;
}

export interface CompareInput {
  task: string;
  providers: ProviderId[];
  workspace?: Partial<WorkspaceConfig>;
  verification?: string[];
  policy?: RunInput["policy"];
  strategy?: {
    isolatedWorktrees?: boolean;
    maxConcurrency?: number;
    stopOnFirstSuccess?: boolean;
  };
}

export interface CompareResult {
  id: string;
  runs: RunResult[];
  summary: CompareSummaryEntry[];
  compareJsonPath?: string;
  compareMarkdownPath?: string;
}

export interface CompareSummaryEntry {
  provider: ProviderId;
  status: RunResult["status"];
  testsPassed?: boolean;
  filesChanged?: number;
  costUsd?: number;
  durationMs?: number;
  patchPath?: string;
  ledgerPath?: string;
  notes?: string;
}

interface CompareRunOutcome {
  index: number;
  result: RunResult;
  summary: CompareSummaryEntry;
}

export interface HandoffInput {
  fromRunId: string;
  toProvider: ProviderId;
  instruction?: string;
  applyPatch?: boolean;
  workspace?: Partial<WorkspaceConfig>;
  verification?: string[];
}

export interface HandoffResult {
  fromLedger: SessionLedger;
  toRun: RunResult;
  handoffPromptPath: string;
}

export interface DoctorInput {
  provider?: ProviderId;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ok: boolean;
  providers: Array<{
    provider: ProviderId;
    registered: boolean;
  }>;
}

export type DoctorCheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  category: "core" | ProviderId;
  name: string;
  status: DoctorCheckStatus;
  message?: string;
}

export function defineConfig<TConfig extends HarnessConfig>(config: TConfig): TConfig {
  return config;
}

export function createHarness(
  config: HarnessConfig,
  adapters: CodingAgentAdapter[] = []
): Harness {
  const adapterMap = new Map<ProviderId, CodingAgentAdapter>(
    adapters.map((adapter) => [adapter.provider, adapter])
  );
  const runStore = new FileRunStore(config);
  const workspaceManager = new FileWorkspaceManager(runStore);

  function requireAdapter(provider: ProviderId): CodingAgentAdapter {
    const adapter = adapterMap.get(provider);
    if (!adapter) {
      throw new AdapterNotFoundError(provider);
    }
    return adapter;
  }

  function resolveProvider(provider?: ProviderId): ProviderId {
    const resolved = provider ?? config.defaultProvider ?? "mock";
    if (!adapterMap.has(resolved)) {
      throw new AdapterNotFoundError(resolved);
    }
    return resolved;
  }

  function buildStartSession(provider: ProviderId, adapter: CodingAgentAdapter) {
    return async function startSession(
      overrides: Partial<StartSessionConfig> = {}
    ): Promise<SessionHandle> {
      const providerConfig = config.providers?.[provider];
      const sessionConfig: StartSessionConfig = {
        provider,
        workspace: {
          ...config.workspace,
          ...overrides.workspace
        }
      };
      const model = overrides.model ?? providerConfig?.model;
      if (model) {
        sessionConfig.model = model;
      }
      const runtime = overrides.runtime ?? providerConfig?.runtime;
      if (runtime) {
        sessionConfig.runtime = runtime;
      }
      const apiKeyEnv = overrides.apiKeyEnv ?? providerConfig?.apiKeyEnv;
      if (apiKeyEnv) {
        sessionConfig.apiKeyEnv = apiKeyEnv;
      }
      sessionConfig.auth = {
        ...(providerConfig?.auth ?? {}),
        ...(overrides.auth ?? {})
      };
      sessionConfig.native = mergeNativeForProvider(
        provider,
        providerConfig?.native,
        overrides.native
      );
      if (providerConfig) {
        sessionConfig.providerConfig = providerConfig;
      }
      return adapter.startSession(sessionConfig);
    };
  }

  function createAgent(providerInput?: ProviderId): HarnessAgent {
    const provider = resolveProvider(providerInput);
    const adapter = requireAdapter(provider);
    const startSession = buildStartSession(provider, adapter);

    return {
      provider,
      capabilities: () => adapter.capabilities(buildCapabilityProbe(provider, config)),
      startSession,
      resumeSession: async (overrides) => {
        const base = await buildResumeSessionConfig(provider, config, overrides);
        return adapter.resumeSession(base);
      },
      startRun: async (input) =>
        startRunWithAdapter(
          adapter,
          startSession,
          input,
          config,
          runStore,
          workspaceManager
        ),
      run: async (input) =>
        runWithAdapter(adapter, startSession, input, config, runStore, workspaceManager),
      startResumeRun: async (input) => {
        const resumeSession = buildResumeSession(provider, adapter, input);
        const runInput = stripResumeRunInput(input);
        return startRunWithAdapter(
          adapter,
          resumeSession,
          runInput,
          config,
          runStore,
          workspaceManager
        );
      },
      resumeRun: async (input) => {
        const resumeSession = buildResumeSession(provider, adapter, input);
        const runInput = stripResumeRunInput(input);
        return runWithAdapter(
          adapter,
          resumeSession,
          runInput,
          config,
          runStore,
          workspaceManager
        );
      }
    };
  }

  return {
    agent: createAgent,
    policy: {
      check: (input) => checkHarnessPolicy(config, input)
    },
    startRun: async (input) => createAgent(input.provider).startRun(input),
    run: async (input) => createAgent(input.provider).run(input),
    startResume: async (input) => createAgent(input.provider).startResumeRun(input),
    resume: async (input) => createAgent(input.provider).resumeRun(input),
    compare: async (input) =>
      compareProviders(
        input,
        config,
        runStore,
        workspaceManager,
        requireAdapter,
        buildStartSession
      ),
    handoff: async (input) =>
      handoffRun(input, config, runStore, createAgent, workspaceManager),
    exportLedger: (runId) => runStore.readLedger(runId),
    importLedger: async (pathOrLedger) => {
      if (typeof pathOrLedger !== "string") {
        return pathOrLedger;
      }
      return readImportedLedger(pathOrLedger);
    },
    doctor: (input) => runDoctor(input, config, adapterMap, runStore),
    dispose: async () => {
      await Promise.all(adapters.map((adapter) => adapter.dispose?.()));
    }
  };

  function buildResumeSession(
    provider: ProviderId,
    adapter: CodingAgentAdapter,
    input: ResumeRunInput
  ) {
    return async function resumeSession(
      overrides: Partial<ResumeSessionConfig> = {}
    ): Promise<SessionHandle> {
      const workspace = mergeWorkspaceConfig(config.workspace, {
        ...input.workspace,
        ...overrides.workspace
      });
      const resumeOverrides: Partial<ResumeSessionConfig> = {
        ...overrides,
        native: {
          ...(input.native ?? {}),
          ...(overrides.native ?? {})
        },
        workspace
      };
      const ledger = input.ledger ?? overrides.ledger;
      if (ledger) {
        resumeOverrides.ledger = ledger;
      }
      const model = overrides.model ?? input.model;
      if (model) {
        resumeOverrides.model = model;
      }
      const runtime = overrides.runtime ?? input.runtime;
      if (runtime) {
        resumeOverrides.runtime = runtime;
      }
      const nativeSessionId =
        overrides.nativeSessionId ??
        input.nativeSessionId ??
        nativeSessionIdFromLedger(provider, ledger);
      if (nativeSessionId) {
        resumeOverrides.nativeSessionId = nativeSessionId;
      }
      const sessionId = overrides.sessionId ?? input.sessionId;
      if (sessionId) {
        resumeOverrides.sessionId = sessionId;
      }
      const base = await buildResumeSessionConfig(provider, config, resumeOverrides);
      return adapter.resumeSession(base);
    };
  }
}

function stripResumeRunInput(input: ResumeRunInput): RunInput {
  const runInput = { ...input } as RunInput & Partial<ResumeRunInput>;
  delete runInput.ledger;
  delete runInput.nativeSessionId;
  delete runInput.sessionId;
  return runInput;
}

interface PolicyParseResult {
  diagnostics: PolicyCheckResult;
  policy?: unknown;
}

interface PolicyCompileResult {
  evaluateCommand?: (command: string) => CommandPolicyEvaluation;
  harnessGuards?: unknown[];
  limits?: RunLimits;
  nativeConfig: Record<string, unknown>;
  warnings: PolicyDiagnostic[];
}

interface CommandPolicyEvaluation {
  decision: "allow" | "deny" | "approval_required";
  matchedRule?: string;
  reason: string;
}

interface PolicyModule {
  compileProviderPolicy?: (provider: ProviderId, policy: unknown) => PolicyCompileResult;
  evaluateCompiledCommandPolicy?: (
    policy: unknown,
    command: string
  ) => CommandPolicyEvaluation;
  parsePolicyFile(path: string): Promise<PolicyParseResult>;
  validatePolicy(value: unknown): PolicyParseResult;
}

async function checkHarnessPolicy(
  config: HarnessConfig,
  input: PolicyCheckInput = {}
): Promise<PolicyCheckResult> {
  const policyModule = await loadPolicyModule();
  if (!policyModule) {
    return failedPolicyCheck({
      code: "POLICY_PACKAGE_UNAVAILABLE",
      message:
        "Policy checks require @metaharness/policy. Install it or use @metaharness/cli."
    });
  }

  const inline = input.inline ?? config.policy?.inline;
  const provider = input.provider;
  const parsed = inline
    ? policyModule.validatePolicy(inline)
    : await parseHarnessPolicyFile(policyModule, config, input);

  if (!parsed.policy || !provider || !policyModule.compileProviderPolicy) {
    return parsed.diagnostics;
  }

  return {
    ...parsed.diagnostics,
    providerWarnings: policyModule.compileProviderPolicy(provider, parsed.policy).warnings
  };
}

async function compileConfiguredProviderPolicy(
  provider: ProviderId,
  config: HarnessConfig,
  input: RunInput,
  cwd: string
): Promise<PolicyCompileResult | undefined> {
  const policyConfig = input.policy ?? config.policy;
  if (!policyConfig) {
    return undefined;
  }

  const policyModule = await loadPolicyModule();
  if (!policyModule) {
    throw new HarnessError(
      "Configured run policy requires @metaharness/policy.",
      "POLICY_PACKAGE_UNAVAILABLE"
    );
  }
  if (!policyModule.compileProviderPolicy) {
    return undefined;
  }

  const parsed = await parseHarnessPolicyConfig(policyModule, config, policyConfig, cwd);
  if (!parsed.policy || !parsed.diagnostics.ok) {
    throw new HarnessError(
      `Run policy is invalid: ${formatPolicyErrors(parsed.diagnostics)}`,
      "POLICY_INVALID"
    );
  }

  const compiled = policyModule.compileProviderPolicy(provider, parsed.policy);
  const result: PolicyCompileResult = {
    ...compiled,
    limits: policyLimitsFromValue(parsed.policy)
  };
  if (policyModule.evaluateCompiledCommandPolicy) {
    result.evaluateCommand = (command) =>
      policyModule.evaluateCompiledCommandPolicy?.(parsed.policy, command) ?? {
        decision: "deny",
        reason: "Policy package did not return a command-policy decision."
      };
  }
  return result;
}

async function parseHarnessPolicyConfig(
  policyModule: PolicyModule,
  config: HarnessConfig,
  policyConfig: HarnessPolicyConfig,
  cwd: string
): Promise<PolicyParseResult> {
  if (policyConfig.inline) {
    return policyModule.validatePolicy(policyConfig.inline);
  }
  const input: PolicyCheckInput = {
    cwd
  };
  if (policyConfig.file) {
    input.file = policyConfig.file;
  }
  return parseHarnessPolicyFile(policyModule, config, input);
}

async function parseHarnessPolicyFile(
  policyModule: PolicyModule,
  config: HarnessConfig,
  input: PolicyCheckInput
): Promise<PolicyParseResult> {
  const cwd = input.cwd ?? config.workspace.cwd;
  const policyPath = resolve(
    cwd,
    input.file ?? config.policy?.file ?? "metaharness.policy.yaml"
  );
  if (!(await pathExists(policyPath))) {
    return {
      diagnostics: failedPolicyCheck({
        code: "POLICY_FILE_NOT_FOUND",
        message: `Policy file "${policyPath}" was not found.`,
        path: policyPath
      })
    };
  }

  try {
    return await policyModule.parsePolicyFile(policyPath);
  } catch (error) {
    return {
      diagnostics: failedPolicyCheck({
        code: "POLICY_CHECK_ERROR",
        message: normalizeError(error).message,
        path: policyPath
      })
    };
  }
}

async function loadPolicyModule(): Promise<PolicyModule | undefined> {
  const policyPackageName = "@metaharness/policy";
  try {
    return (await import(policyPackageName)) as PolicyModule;
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function failedPolicyCheck(error: PolicyDiagnostic): PolicyCheckResult {
  return {
    errors: [error],
    ok: false,
    providerWarnings: [],
    warnings: []
  };
}

function formatPolicyErrors(diagnostics: PolicyCheckResult): string {
  const messages = diagnostics.errors.map((error) =>
    error.path ? `${error.path}: ${error.message}` : error.message
  );
  return messages.join("; ") || "policy did not produce an effective policy";
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
}

async function runDoctor(
  input: DoctorInput | undefined,
  config: HarnessConfig,
  adapterMap: Map<ProviderId, CodingAgentAdapter>,
  runStore: FileRunStore
): Promise<DoctorReport> {
  const providers = selectedDoctorProviders(input).map((provider) => ({
    provider,
    registered: adapterMap.has(provider)
  }));
  const checks: DoctorCheck[] = [];

  checks.push(nodeDoctorCheck());
  checks.push(await workspaceDoctorCheck(config.workspace.cwd));
  checks.push(await storageDoctorCheck(runStore));
  checks.push(await policyDoctorCheck(config));
  checks.push(await gitDoctorCheck(config));

  for (const provider of providers) {
    checks.push({
      category: provider.provider,
      name: `${provider.provider} adapter registered`,
      status: provider.registered ? "ok" : "fail"
    });

    const adapter = adapterMap.get(provider.provider);
    checks.push(await providerCapabilitiesDoctorCheck(provider.provider, adapter));
    checks.push(providerAuthDoctorCheck(config, provider.provider));
  }

  return {
    checks,
    ok: checks.every((check) => check.status !== "fail"),
    providers
  };
}

function selectedDoctorProviders(input: DoctorInput | undefined): ProviderId[] {
  return input?.provider ? [input.provider] : ["mock", "claude", "cursor", "codex"];
}

function nodeDoctorCheck(): DoctorCheck {
  const major = Number(process.versions.node.split(".")[0] ?? "0");
  return {
    category: "core",
    message: process.version,
    name: "node >=22",
    status: major >= 22 ? "ok" : "fail"
  };
}

async function workspaceDoctorCheck(cwd: string): Promise<DoctorCheck> {
  try {
    await access(cwd);
    return {
      category: "core",
      message: cwd,
      name: "workspace exists",
      status: "ok"
    };
  } catch (error) {
    return {
      category: "core",
      message: normalizeError(error).message,
      name: "workspace exists",
      status: "fail"
    };
  }
}

async function storageDoctorCheck(runStore: FileRunStore): Promise<DoctorCheck> {
  try {
    await mkdir(runStore.rootDir, { recursive: true });
    const probeDir = await mkdtemp(resolve(runStore.rootDir, "doctor-"));
    await writeFile(resolve(probeDir, "probe.txt"), "ok\n", "utf8");
    await rm(probeDir, { force: true, recursive: true });
    return {
      category: "core",
      message: runStore.rootDir,
      name: "run directory writable",
      status: "ok"
    };
  } catch (error) {
    return {
      category: "core",
      message: normalizeError(error).message,
      name: "run directory writable",
      status: "fail"
    };
  }
}

async function policyDoctorCheck(config: HarnessConfig): Promise<DoctorCheck> {
  if (!config.policy) {
    return {
      category: "core",
      message: "no policy configured",
      name: "policy valid",
      status: "skip"
    };
  }
  const diagnostics = await checkHarnessPolicy(config);
  const check: DoctorCheck = {
    category: "core",
    name: "policy valid",
    status: diagnostics.ok ? "ok" : "fail"
  };
  const message = formatDoctorDiagnostics(diagnostics);
  if (message) {
    check.message = message;
  }
  return check;
}

async function gitDoctorCheck(config: HarnessConfig): Promise<DoctorCheck> {
  if (!(await isGitRepository(config.workspace.cwd))) {
    return {
      category: "core",
      message: "workspace is not a git repository",
      name: "git status",
      status: config.workspace.git?.requireClean ? "fail" : "warn"
    };
  }
  const dirty = await gitDirty(config.workspace.cwd);
  return {
    category: "core",
    message: dirty ? "workspace has uncommitted changes" : "workspace clean",
    name: "git status",
    status: dirty && config.workspace.git?.requireClean ? "fail" : "ok"
  };
}

async function providerCapabilitiesDoctorCheck(
  provider: ProviderId,
  adapter: CodingAgentAdapter | undefined
): Promise<DoctorCheck> {
  if (!adapter) {
    return {
      category: provider,
      name: "capabilities loaded",
      status: "skip"
    };
  }
  try {
    const capabilities = await adapter.capabilities();
    const check: DoctorCheck = {
      category: provider,
      name: "capabilities loaded",
      status: "ok"
    };
    if (capabilities.nativeVersion) {
      check.message = capabilities.nativeVersion;
    }
    return check;
  } catch (error) {
    return {
      category: provider,
      message: normalizeError(error).message,
      name: "capabilities loaded",
      status: "fail"
    };
  }
}

function providerAuthDoctorCheck(
  config: HarnessConfig,
  provider: ProviderId
): DoctorCheck {
  const providerConfig = config.providers?.[provider];
  const apiKeyEnv = providerConfig?.apiKeyEnv;
  if (!apiKeyEnv) {
    return {
      category: provider,
      name: "api key present",
      status: "skip"
    };
  }
  return {
    category: provider,
    message: apiKeyEnv,
    name: "api key present",
    status:
      providerConfig.auth?.apiKey ||
      providerConfig.auth?.[apiKeyEnv] ||
      process.env[apiKeyEnv]
        ? "ok"
        : "fail"
  };
}

function formatDoctorDiagnostics(diagnostics: PolicyCheckResult): string | undefined {
  const messages = [...diagnostics.errors, ...diagnostics.warnings].map((diagnostic) =>
    diagnostic.path ? `${diagnostic.path}: ${diagnostic.message}` : diagnostic.message
  );
  return messages.join("; ") || undefined;
}

function mergeNativeForProvider(
  provider: ProviderId,
  ...sources: Array<Record<string, unknown> | undefined>
): Record<string, unknown> {
  const available = sources.filter(isRecord);
  if (available.length === 0) {
    return {};
  }
  const hasScopedNative = available.some((source) => isRecord(source[provider]));
  if (!hasScopedNative) {
    return Object.assign({}, ...available) as Record<string, unknown>;
  }

  const scoped: Record<string, unknown> = {};
  for (const source of available) {
    Object.assign(scoped, isRecord(source[provider]) ? source[provider] : source);
  }
  return {
    [provider]: scoped
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRunInput(input: RunInput): void {
  const candidate = input as Partial<RunInput> | undefined;
  if (!candidate || typeof candidate !== "object" || !isNonEmptyString(candidate.task)) {
    throw new HarnessInputError(
      "Run task must be a non-empty string.",
      "RUN_TASK_MISSING"
    );
  }
}

function validateCompareInput(input: CompareInput): void {
  const candidate = input as Partial<CompareInput> | undefined;
  if (!candidate || typeof candidate !== "object" || !isNonEmptyString(candidate.task)) {
    throw new HarnessInputError(
      "Compare task must be a non-empty string.",
      "COMPARE_TASK_MISSING"
    );
  }
  if (!Array.isArray(candidate.providers) || candidate.providers.length === 0) {
    throw new HarnessInputError(
      "Compare requires at least one provider in input.providers.",
      "COMPARE_NO_PROVIDERS"
    );
  }
}

function validateHandoffInput(input: HandoffInput): void {
  const candidate = input as Partial<HandoffInput> | undefined;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !isNonEmptyString(candidate.fromRunId)
  ) {
    throw new HarnessInputError(
      "Handoff requires a source run id in input.fromRunId.",
      "HANDOFF_SOURCE_MISSING"
    );
  }
  if (!isNonEmptyString(candidate.toProvider)) {
    throw new HarnessInputError(
      "Handoff requires a destination provider in input.toProvider.",
      "HANDOFF_PROVIDER_MISSING"
    );
  }
}

async function startRunWithAdapter(
  adapter: CodingAgentAdapter,
  startSession: (overrides?: Partial<StartSessionConfig>) => Promise<SessionHandle>,
  input: RunInput,
  config: HarnessConfig,
  runStore: FileRunStore,
  workspaceManager: FileWorkspaceManager,
  options: RunWithAdapterOptions = {}
): Promise<ActiveRun> {
  const eventBuffer = new RunEventBuffer();
  let nativeRun: RunHandle | undefined;
  let resultPromise: Promise<RunResult> | undefined;

  const started = new Promise<ActiveRun>((resolve, reject) => {
    resultPromise = Promise.resolve()
      .then(() =>
        runWithAdapter(adapter, startSession, input, config, runStore, workspaceManager, {
          ...options,
          onEvent: async (event) => {
            eventBuffer.append(event);
            await options.onEvent?.(event);
          },
          onRunStarted: async (run) => {
            nativeRun = run;
            resolve(createActiveRun(adapter, run, eventBuffer, () => resultPromise));
            await options.onRunStarted?.(run);
          }
        })
      )
      .then(
        (result) => {
          eventBuffer.close();
          return result;
        },
        (error) => {
          eventBuffer.fail(error);
          reject(error);
          throw error;
        }
      );
  });

  void resultPromise?.catch(() => undefined);
  const active = await started;
  if (!nativeRun) {
    throw new HarnessError(
      "Provider run did not expose a native run handle.",
      "RUN_HANDLE_UNAVAILABLE"
    );
  }
  return active;
}

function createActiveRun(
  adapter: CodingAgentAdapter,
  run: RunHandle,
  eventBuffer: RunEventBuffer,
  resultPromise: () => Promise<RunResult> | undefined
): ActiveRun {
  const active: ActiveRun = {
    cancel: () => adapter.cancel(run),
    events: () => eventBuffer.read(),
    provider: run.provider,
    runId: run.runId,
    sessionId: run.sessionId,
    startedAt: run.startedAt,
    wait: () => {
      const pending = resultPromise();
      if (!pending) {
        return Promise.reject(
          new HarnessError("Run result is not available yet.", "RUN_RESULT_UNAVAILABLE")
        );
      }
      return pending;
    }
  };
  if (run.nativeRunId) {
    active.nativeRunId = run.nativeRunId;
  }
  if (run.nativeSessionId) {
    active.nativeSessionId = run.nativeSessionId;
  }
  return active;
}

class RunEventBuffer {
  private readonly events: PortableRunEvent[] = [];
  private closed = false;
  private error: unknown;
  private readonly waiters = new Set<() => void>();

  append(event: PortableRunEvent): void {
    if (this.closed) {
      return;
    }
    this.events.push(event);
    this.notify();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.notify();
  }

  fail(error: unknown): void {
    if (this.closed) {
      return;
    }
    this.error = error;
    this.closed = true;
    this.notify();
  }

  async *read(): AsyncIterable<PortableRunEvent> {
    let index = 0;
    while (true) {
      if (index < this.events.length) {
        const event = this.events[index];
        index += 1;
        if (event) {
          yield event;
        }
        continue;
      }
      if (this.closed) {
        if (this.error) {
          throw this.error;
        }
        return;
      }
      await this.waitForEvent();
    }
  }

  private waitForEvent(): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.add(resolve);
    });
  }

  private notify(): void {
    for (const waiter of this.waiters) {
      waiter();
    }
    this.waiters.clear();
  }
}

async function compareProviders(
  input: CompareInput,
  config: HarnessConfig,
  runStore: FileRunStore,
  workspaceManager: FileWorkspaceManager,
  requireAdapter: (provider: ProviderId) => CodingAgentAdapter,
  buildStartSession: (
    provider: ProviderId,
    adapter: CodingAgentAdapter
  ) => (overrides?: Partial<StartSessionConfig>) => Promise<SessionHandle>
): Promise<CompareResult> {
  validateCompareInput(input);
  const compareId = createCompareId();
  const maxConcurrency = input.strategy?.maxConcurrency ?? 1;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new HarnessError(
      "Compare strategy maxConcurrency must be a positive integer.",
      "COMPARE_INVALID_CONCURRENCY"
    );
  }
  const outcomes: CompareRunOutcome[] = [];
  const baseWorkspace = mergeWorkspaceConfig(config.workspace, input.workspace);
  const isolatedWorktrees = input.strategy?.isolatedWorktrees ?? true;
  let nextProviderIndex = 0;
  let stopScheduling = false;

  const workerCount = Math.min(maxConcurrency, input.providers.length);
  await Promise.all(Array.from({ length: workerCount }, () => runCompareWorker()));

  outcomes.sort((left, right) => left.index - right.index);
  const runs = outcomes.map((outcome) => outcome.result);
  const summary = outcomes.map((outcome) => outcome.summary);

  const paths = runStore.comparePaths(compareId);
  const compareResult: CompareResult = {
    compareJsonPath: paths.json,
    compareMarkdownPath: paths.markdown,
    id: compareId,
    runs,
    summary
  };
  await runStore.writeCompare(
    compareId,
    compareResult,
    renderCompareMarkdown(compareResult)
  );
  return compareResult;

  async function runCompareWorker(): Promise<void> {
    while (!stopScheduling) {
      const index = nextProviderIndex;
      const provider = input.providers[index];
      if (!provider) {
        return;
      }
      nextProviderIndex += 1;

      const outcome = await runCompareProvider(provider, index);
      outcomes.push(outcome);

      if (
        input.strategy?.stopOnFirstSuccess &&
        outcome.summary.status === "success" &&
        outcome.summary.testsPassed !== false
      ) {
        stopScheduling = true;
        return;
      }
    }
  }

  async function runCompareProvider(
    provider: ProviderId,
    index: number
  ): Promise<CompareRunOutcome> {
    const adapter = requireAdapter(provider);
    const runWorkspace: WorkspaceConfig = {
      ...baseWorkspace
    };
    runWorkspace.git = {
      ...(baseWorkspace.git ?? {}),
      createWorktree: isolatedWorktrees,
      branchPrefix: baseWorkspace.git?.branchPrefix ?? `compare/${provider}/`
    };

    const startedAt = Date.now();
    const runInput: RunInput = {
      metadata: {
        compareId,
        compareIndex: index
      },
      task: input.task,
      workspace: runWorkspace
    };
    if (input.policy) {
      runInput.policy = input.policy;
    }
    const runOptions: RunWithAdapterOptions = {};
    if (input.verification) {
      runOptions.verification = input.verification;
    }
    const result = await runWithAdapter(
      adapter,
      buildStartSession(provider, adapter),
      runInput,
      config,
      runStore,
      workspaceManager,
      runOptions
    );
    const ledger = await runStore.readLedger(result.runId);
    return {
      index,
      result,
      summary: compareSummaryEntry(provider, result, ledger, Date.now() - startedAt)
    };
  }
}

async function handoffRun(
  input: HandoffInput,
  config: HarnessConfig,
  runStore: FileRunStore,
  createAgent: (providerInput?: ProviderId) => HarnessAgent,
  workspaceManager: FileWorkspaceManager
): Promise<HandoffResult> {
  validateHandoffInput(input);
  const fromLedger = await runStore.readLedger(input.fromRunId);
  const prompt = renderHandoffPrompt(fromLedger, input.instruction);
  const handoffPromptPath = await runStore.writeHandoff(input.fromRunId, prompt);
  let patchedWorkspace: PreparedWorkspace | undefined;
  let runWorkspace: Partial<WorkspaceConfig> | undefined = input.workspace;

  try {
    if (input.applyPatch) {
      const patchPath = fromLedger.diff.patchPath;
      if (!patchPath) {
        throw new HarnessError(
          `Run "${input.fromRunId}" does not have a captured patch to apply.`,
          "HANDOFF_PATCH_MISSING"
        );
      }
      const destinationWorkspace = mergeWorkspaceConfig(
        config.workspace,
        input.workspace
      );
      patchedWorkspace = await workspaceManager.prepare(destinationWorkspace);
      await applyCapturedPatch(patchedWorkspace.cwd, patchPath);
      runWorkspace = workspaceConfigForPreparedHandoff(
        destinationWorkspace,
        patchedWorkspace
      );
    }

    const runInput: RunInput = {
      metadata: {
        handoffFrom: {
          ledgerId: fromLedger.ledgerId,
          provider: fromLedger.provider.id,
          runId: input.fromRunId
        }
      },
      task: prompt
    };
    if (runWorkspace) {
      runInput.workspace = runWorkspace;
    }
    if (input.verification) {
      runInput.verification = input.verification;
    }
    const toRun = await createAgent(input.toProvider).run(runInput);

    return {
      fromLedger,
      handoffPromptPath,
      toRun
    };
  } finally {
    await patchedWorkspace?.cleanup?.();
  }
}

function workspaceConfigForPreparedHandoff(
  destination: WorkspaceConfig,
  prepared: PreparedWorkspace
): WorkspaceConfig {
  const workspace: WorkspaceConfig = {
    ...destination,
    cwd: prepared.cwd
  };
  if (destination.git || prepared.gitRoot) {
    workspace.git = {
      ...(destination.git ?? {}),
      createWorktree: false,
      requireClean: false
    };
  }
  return workspace;
}

function renderHandoffPrompt(ledger: SessionLedger, instruction?: string): string {
  const base = renderHandoffMarkdown(ledger);
  if (!instruction) {
    return base;
  }
  return `${base}
## Additional handoff instruction
${instruction}
`;
}

async function applyCapturedPatch(cwd: string, patchPath: string): Promise<void> {
  const patch = await readFile(patchPath, "utf8");
  if (!isMetaharnessSnapshotPatch(patch)) {
    await runGit(cwd, ["apply", patchPath]);
    return;
  }
  await applyMetaharnessSnapshotPatch(cwd, patch);
}

function isMetaharnessSnapshotPatch(patch: string): boolean {
  for (const line of patch.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    return line.startsWith("diff --metaharness ");
  }
  return false;
}

async function applyMetaharnessSnapshotPatch(cwd: string, patch: string): Promise<void> {
  const blocks = splitMetaharnessPatchBlocks(patch);
  if (blocks.length === 0) {
    throw new HarnessError(
      "Metaharness snapshot patch did not contain any file changes.",
      "HANDOFF_PATCH_INVALID"
    );
  }

  for (const block of blocks) {
    await applyMetaharnessSnapshotPatchBlock(cwd, block);
  }
}

async function applyMetaharnessSnapshotPatchBlock(
  cwd: string,
  block: readonly string[]
): Promise<void> {
  if (block.some((line) => line.startsWith("Binary files "))) {
    throw new HarnessError(
      "Metaharness snapshot patch contains binary changes that cannot be applied for handoff.",
      "HANDOFF_PATCH_UNSUPPORTED"
    );
  }

  const oldPath = headerPath(block, "--- ");
  const newPath = headerPath(block, "+++ ");
  if (!oldPath || !newPath) {
    throw new HarnessError(
      "Metaharness snapshot patch is missing file headers.",
      "HANDOFF_PATCH_INVALID"
    );
  }

  if (newPath === "/dev/null") {
    const target = resolvePatchTarget(cwd, oldPath);
    if (target) {
      await rm(target, {
        force: true
      });
    }
    return;
  }

  const target = resolvePatchTarget(cwd, newPath);
  if (!target) {
    throw new HarnessError(
      "Metaharness snapshot patch has no target file path.",
      "HANDOFF_PATCH_INVALID"
    );
  }

  const hunkIndex = block.findIndex((line) => line.startsWith("@@ "));
  if (hunkIndex === -1) {
    throw new HarnessError(
      "Metaharness snapshot patch is missing a text hunk.",
      "HANDOFF_PATCH_INVALID"
    );
  }

  const nextLines: string[] = [];
  for (const line of block.slice(hunkIndex + 1)) {
    if (line.startsWith("+")) {
      nextLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith(" ")) {
      nextLines.push(line.slice(1));
      continue;
    }
    if (line.startsWith("-") || line === "") {
      continue;
    }
    throw new HarnessError(
      `Metaharness snapshot patch contains an unsupported hunk line: ${line}`,
      "HANDOFF_PATCH_INVALID"
    );
  }

  await mkdir(dirname(target), {
    recursive: true
  });
  await writeFile(
    target,
    nextLines.length > 0 ? `${nextLines.join("\n")}\n` : "",
    "utf8"
  );
}

function splitMetaharnessPatchBlocks(patch: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --metaharness ")) {
      if (current) {
        blocks.push(trimTrailingBlankLines(current));
      }
      current = [line];
      continue;
    }
    if (!current) {
      if (line.trim()) {
        throw new HarnessError(
          "Metaharness snapshot patch contains content before the first file diff.",
          "HANDOFF_PATCH_INVALID"
        );
      }
      continue;
    }
    current.push(line);
  }
  if (current) {
    blocks.push(trimTrailingBlankLines(current));
  }
  return blocks;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];
  while (next.at(-1) === "") {
    next.pop();
  }
  return next;
}

function headerPath(
  block: readonly string[],
  prefix: "--- " | "+++ "
): string | undefined {
  return block.find((line) => line.startsWith(prefix))?.slice(prefix.length);
}

function resolvePatchTarget(cwd: string, patchPath: string): string | undefined {
  if (patchPath === "/dev/null") {
    return undefined;
  }
  const relativePath =
    patchPath.startsWith("a/") || patchPath.startsWith("b/")
      ? patchPath.slice(2)
      : patchPath;
  if (!relativePath || relativePath.includes("\0") || isAbsolute(relativePath)) {
    throw new HarnessError(
      `Metaharness snapshot patch contains an unsafe path: ${patchPath}`,
      "HANDOFF_PATCH_UNSAFE_PATH"
    );
  }
  const resolved = resolve(cwd, relativePath);
  const inside = relative(cwd, resolved);
  if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
    throw new HarnessError(
      `Metaharness snapshot patch targets outside the workspace: ${patchPath}`,
      "HANDOFF_PATCH_UNSAFE_PATH"
    );
  }
  return resolved;
}

function compareSummaryEntry(
  provider: ProviderId,
  result: RunResult,
  ledger: SessionLedger,
  durationMs: number
): CompareSummaryEntry {
  const entry: CompareSummaryEntry = {
    durationMs,
    provider,
    status: result.status
  };
  if (ledger.verification.length > 0) {
    entry.testsPassed = ledger.verification.every(
      (verification) => verification.exitCode === 0
    );
  }
  if (ledger.diff.stats?.filesChanged !== undefined) {
    entry.filesChanged = ledger.diff.stats.filesChanged;
  }
  if (result.usage?.estimatedCostUsd !== undefined) {
    entry.costUsd = result.usage.estimatedCostUsd;
  }
  if (result.patchPath) {
    entry.patchPath = result.patchPath;
  }
  if (result.ledgerPath) {
    entry.ledgerPath = result.ledgerPath;
  }
  if (result.finalMessage) {
    entry.notes = result.finalMessage.slice(0, 160);
  }
  return entry;
}

function renderCompareMarkdown(result: CompareResult): string {
  const rows = result.summary.map((entry, index) =>
    [
      entry.provider,
      result.runs[index]?.runId ?? "unknown-run",
      entry.status,
      entry.testsPassed === undefined ? "n/a" : entry.testsPassed ? "pass" : "fail",
      String(entry.filesChanged ?? "n/a"),
      entry.costUsd === undefined ? "n/a" : `$${entry.costUsd.toFixed(4)}`,
      formatDuration(entry.durationMs),
      entry.patchPath ?? "n/a"
    ].join(" | ")
  );
  return `# metaharness compare

Compare id: ${result.id}

provider | run id | status | verify | files | cost | duration | patch
--- | --- | --- | --- | --- | --- | --- | ---
${rows.join("\n")}
`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "n/a";
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function buildCapabilityProbe(
  provider: ProviderId,
  config: HarnessConfig
): CapabilityProbeInput {
  const probe: CapabilityProbeInput = {
    cwd: config.workspace.cwd
  };
  const providerConfig = config.providers?.[provider];
  if (providerConfig?.runtime) {
    probe.runtime = providerConfig.runtime;
  }
  if (providerConfig?.auth) {
    probe.auth = providerConfig.auth;
  }
  return probe;
}

async function runWithAdapter(
  adapter: CodingAgentAdapter,
  startSession: (overrides?: Partial<StartSessionConfig>) => Promise<SessionHandle>,
  input: RunInput,
  config: HarnessConfig,
  runStore: FileRunStore,
  workspaceManager: FileWorkspaceManager,
  options: RunWithAdapterOptions = {}
): Promise<RunResult> {
  validateRunInput(input);
  const runtime = input.runtime ?? config.providers?.[adapter.provider]?.runtime;
  return withHarnessSpan(
    "harness.run",
    spanAttributes({
      "harness.provider": adapter.provider,
      "harness.runtime": runtime,
      "harness.task_hash": hashTask(input.task)
    }),
    async (runSpan) => {
      const runStartedAt = Date.now();
      const workspaceConfig = mergeWorkspaceConfig(config.workspace, input.workspace);
      const prepared = await workspaceManager.prepare(workspaceConfig);
      let recorder: ReturnType<FileRunStore["createRecorder"]> | undefined;
      const recordedEvents: PortableRunEvent[] = [];
      const rawEventsEnabled = input.rawEvents ?? config.rawEvents ?? false;
      let lastObservedSeq = 0;

      try {
        const compiledPolicy = await compileConfiguredProviderPolicy(
          adapter.provider,
          config,
          input,
          prepared.cwd
        );
        const beforeSnapshot = await workspaceManager.snapshot(prepared);
        const session = await withHarnessSpan(
          "provider.startSession",
          spanAttributes({
            "harness.provider": adapter.provider,
            "harness.runtime": runtime
          }),
          async (span) => {
            const sessionOverrides: Partial<StartSessionConfig> = {
              workspace: {
                ...workspaceConfig,
                cwd: prepared.cwd
              }
            };
            if (input.model) {
              sessionOverrides.model = input.model;
            }
            if (input.runtime) {
              sessionOverrides.runtime = input.runtime;
            }
            if (compiledPolicy?.nativeConfig) {
              sessionOverrides.native = compiledPolicy.nativeConfig;
            }
            const started = await startSession(sessionOverrides);
            span.setAttributes(
              spanAttributes({
                "harness.session_id": started.sessionId,
                "harness.provider": adapter.provider,
                "harness.runtime": runtime
              })
            );
            return started;
          }
        );
        runSpan.setAttributes(
          spanAttributes({
            "harness.session_id": session.sessionId,
            "harness.runtime": runtime
          })
        );

        const runInput: RunInput = {
          ...input,
          workspace: {
            ...workspaceConfig,
            cwd: prepared.cwd
          }
        };
        if (!runInput.policy && config.policy) {
          runInput.policy = config.policy;
        }
        if (compiledPolicy?.nativeConfig) {
          runInput.native = mergeNativeForProvider(
            adapter.provider,
            compiledPolicy.nativeConfig,
            input.native
          );
        }
        const run = await withHarnessSpan(
          "provider.run",
          spanAttributes({
            "harness.provider": adapter.provider,
            "harness.runtime": runtime,
            "harness.session_id": session.sessionId
          }),
          async (span) => {
            const startedRun = await adapter.run(session, runInput);
            span.setAttributes(
              spanAttributes({
                "harness.run_id": startedRun.runId,
                "harness.session_id": startedRun.sessionId
              })
            );
            await options.onRunStarted?.(startedRun);
            return startedRun;
          }
        );
        runSpan.setAttributes(
          spanAttributes({
            "harness.run_id": run.runId,
            "harness.session_id": run.sessionId
          })
        );

        const paths = await runStore.ensureRun(run.runId);
        recorder = runStore.createRecorder(run.runId, {
          rawEvents: rawEventsEnabled,
          redactSecrets: config.storage?.redactSecrets !== false
        });
        const appendSyntheticEvent = async (event: PortableRunEvent) => {
          lastObservedSeq = Math.max(lastObservedSeq, event.seq);
          await recorder?.append(event);
          recordedEvents.push(event);
          await options.onEvent?.(event);
        };
        const nextSyntheticSeq = () => {
          lastObservedSeq += 1;
          return lastObservedSeq;
        };

        await withHarnessSpan(
          "provider.stream",
          spanAttributes({
            "harness.provider": adapter.provider,
            "harness.run_id": run.runId,
            "harness.runtime": runtime,
            "harness.session_id": run.sessionId
          }),
          async (span) => {
            let eventCount = 0;
            for await (const event of adapter.stream(run)) {
              lastObservedSeq = Math.max(lastObservedSeq, event.seq);
              await recorder?.append(event);
              eventCount += 1;
              if (event.type !== "provider.raw" || rawEventsEnabled) {
                recordedEvents.push(event);
                await options.onEvent?.(event);
              }
            }
            span.setAttribute("harness.event_count", eventCount);
          }
        );

        if (!recordedEvents.some((event) => event.type === "run.started")) {
          await appendSyntheticEvent(
            createSyntheticRunStartedEvent({
              cwd: prepared.cwd,
              input: runInput,
              nextSeq: nextSyntheticSeq,
              provider: adapter.provider,
              runId: run.runId,
              sessionId: run.sessionId
            })
          );
        }

        const waited = await withHarnessSpan(
          "provider.wait",
          spanAttributes({
            "harness.provider": adapter.provider,
            "harness.run_id": run.runId,
            "harness.runtime": runtime,
            "harness.session_id": run.sessionId
          }),
          async (span) => {
            const waitedRun = await adapter.wait(run);
            span.setAttributes(
              spanAttributes({
                "harness.cost_usd": waitedRun.usage?.estimatedCostUsd,
                "harness.status": waitedRun.status
              })
            );
            return waitedRun;
          }
        );
        const verification = await runVerificationCommands(
          options.verification ?? input.verification,
          {
            cwd: prepared.cwd,
            outputPath: paths.verification,
            redactSecrets: config.storage?.redactSecrets !== false
          }
        );
        const afterSnapshot = await workspaceManager.snapshot(prepared);
        const workspaceDiff = await withHarnessSpan(
          "workspace.diff",
          spanAttributes({
            "harness.provider": adapter.provider,
            "harness.run_id": run.runId,
            "harness.runtime": runtime,
            "harness.session_id": run.sessionId
          }),
          async (span) => {
            const diff = await workspaceManager.diff(prepared);
            span.setAttributes(
              spanAttributes({
                "harness.files_changed": diff.filesChanged
              })
            );
            return diff;
          }
        );
        const capturedDiff = workspaceDiff.unifiedDiff || waited.diff;
        let patchPath = waited.patchPath;

        if (workspaceDiff.unifiedDiff) {
          patchPath = await workspaceManager.writePatch(
            run.runId,
            workspaceDiff.unifiedDiff
          );
        } else if (waited.diff && !patchPath) {
          patchPath = await runStore.writePatch(run.runId, waited.diff);
        }

        if (
          capturedDiff &&
          !recordedEvents.some((event) => event.type === "diff.updated")
        ) {
          const seq = nextSyntheticSeq();
          const diffEvent: PortableRunEvent = {
            id: createEventId(run.runId, seq),
            provider: adapter.provider,
            runId: run.runId,
            seq,
            sessionId: run.sessionId,
            ts: new Date().toISOString(),
            type: "diff.updated",
            unifiedDiff: capturedDiff
          };
          await appendSyntheticEvent(diffEvent);
        }

        let result: RunResult = {
          ...waited,
          artifacts: waited.artifacts,
          eventLogPath: paths.events,
          handoffPath: paths.handoff,
          ledgerPath: paths.ledger,
          verificationLogPath: paths.verification
        };
        if (capturedDiff) {
          result.diff = capturedDiff;
        }
        if (patchPath) {
          result.patchPath = patchPath;
        }

        const verificationMessage = failedVerificationMessage(verification);
        if (verificationMessage) {
          result = {
            ...result,
            finalMessage: verificationMessage,
            status: "failed"
          };
        }

        const commandPolicyError = checkObservableCommandPolicy(
          compiledPolicy?.evaluateCommand,
          recordedEvents
        );
        if (commandPolicyError) {
          result = {
            ...result,
            finalMessage: commandPolicyError.message,
            status: "failed"
          };
          const failureEvents = createCommandPolicyFailureEvents({
            error: commandPolicyError,
            nextSeq: nextSyntheticSeq,
            provider: adapter.provider,
            result,
            runId: run.runId,
            sessionId: run.sessionId
          });
          for (const event of failureEvents) {
            await appendSyntheticEvent(event);
          }
        }

        const limitError = commandPolicyError
          ? undefined
          : checkRunLimits(effectiveRunLimits(input, config, compiledPolicy?.limits), {
              diff: capturedDiff,
              durationMs: Date.now() - runStartedAt,
              events: recordedEvents,
              filesChanged: workspaceDiff.filesChanged,
              usage: waited.usage
            });
        if (limitError) {
          result = {
            ...result,
            finalMessage: limitError.message,
            status: "failed"
          };
          const failureEvents = createLimitFailureEvents({
            error: limitError,
            nextSeq: nextSyntheticSeq,
            provider: adapter.provider,
            result,
            runId: run.runId,
            sessionId: run.sessionId
          });
          for (const event of failureEvents) {
            await appendSyntheticEvent(event);
          }
        }

        if (!recordedEvents.some((event) => event.type === "run.completed")) {
          await appendSyntheticEvent(
            createSyntheticRunCompletedEvent({
              nextSeq: nextSyntheticSeq,
              provider: adapter.provider,
              result,
              runId: run.runId,
              sessionId: run.sessionId
            })
          );
        }

        const adapterSnapshot = await withHarnessSpan(
          "provider.snapshot",
          spanAttributes({
            "harness.provider": adapter.provider,
            "harness.run_id": run.runId,
            "harness.runtime": runtime,
            "harness.session_id": run.sessionId
          }),
          async () => adapter.snapshot?.(session)
        );

        await recorder.close();

        const ledger = buildSessionLedger({
          adapterSnapshot,
          config,
          events: recordedEvents,
          input: runInput,
          paths,
          result,
          verification,
          workspace: {
            after: afterSnapshot,
            before: beforeSnapshot,
            diff: workspaceDiff,
            prepared
          }
        });
        const handoff = renderHandoffMarkdown(ledger);

        await withHarnessSpan(
          "ledger.write",
          spanAttributes({
            "harness.files_changed": workspaceDiff.filesChanged,
            "harness.provider": adapter.provider,
            "harness.run_id": run.runId,
            "harness.runtime": runtime,
            "harness.session_id": run.sessionId,
            "harness.status": result.status
          }),
          async () => {
            await runStore.writeLedger(run.runId, ledger);
            await runStore.writeHandoff(run.runId, handoff);
            await runStore.writeResult(run.runId, result);
          }
        );

        runSpan.setAttributes(
          spanAttributes({
            "harness.cost_usd": result.usage?.estimatedCostUsd,
            "harness.files_changed": workspaceDiff.filesChanged,
            "harness.status": result.status
          })
        );

        return result;
      } finally {
        await recorder?.close();
        await prepared.cleanup?.();
      }
    }
  );
}

interface RunLimitFacts {
  diff: string | undefined;
  durationMs: number;
  events: PortableRunEvent[];
  filesChanged: number;
  usage: RunResult["usage"] | undefined;
}

interface CreateCommandPolicyFailureEventsInput {
  error: CommandPolicyViolationError;
  nextSeq: () => number;
  provider: ProviderId;
  result: RunResult;
  runId: string;
  sessionId: string;
}

interface CreateLimitFailureEventsInput {
  error: RunLimitExceededError;
  nextSeq: () => number;
  provider: ProviderId;
  result: RunResult;
  runId: string;
  sessionId: string;
}

interface CreateSyntheticRunStartedEventInput {
  cwd: string;
  input: RunInput;
  nextSeq: () => number;
  provider: ProviderId;
  runId: string;
  sessionId: string;
}

interface CreateSyntheticRunCompletedEventInput {
  nextSeq: () => number;
  provider: ProviderId;
  result: RunResult;
  runId: string;
  sessionId: string;
}

const runLimitKeys = [
  "maxTurns",
  "maxDurationMs",
  "maxCostUsd",
  "maxFilesChanged",
  "maxDiffBytes"
] as const;

function effectiveRunLimits(
  input: RunInput,
  config: HarnessConfig,
  policyLimits: RunLimits | undefined
): RunLimits | undefined {
  const limits: RunLimits = {};
  mergeRunLimits(limits, policyLimits);
  if (!policyLimits) {
    mergeRunLimits(limits, inlinePolicyLimits(config.policy?.inline));
    mergeRunLimits(limits, inlinePolicyLimits(input.policy?.inline));
  }
  mergeRunLimits(limits, input.limits);
  return Object.keys(limits).length > 0 ? limits : undefined;
}

function policyLimitsFromValue(value: unknown): RunLimits {
  if (!isRecord(value) || !isRecord(value.limits)) {
    return {};
  }
  const limits: RunLimits = {};
  for (const key of runLimitKeys) {
    const candidate = value.limits[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      limits[key] = candidate;
    }
  }
  return limits;
}

function inlinePolicyLimits(inline: Record<string, unknown> | undefined): RunLimits {
  const limits = inline?.limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    return {};
  }
  return limits as RunLimits;
}

function mergeRunLimits(target: RunLimits, source: RunLimits | undefined): void {
  if (!source) {
    return;
  }
  for (const key of runLimitKeys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      target[key] = value;
    }
  }
}

function failedVerificationMessage(
  verification: VerificationResult[]
): string | undefined {
  const failed = verification.filter((entry) => entry.exitCode !== 0);
  if (failed.length === 0) {
    return undefined;
  }

  const first = failed[0];
  const exit =
    first?.exitCode === undefined ? "unknown exit code" : `exit ${first.exitCode}`;
  const suffix =
    failed.length === 1 ? "" : ` and ${failed.length - 1} more verification command(s)`;
  const summary = first?.summary ? `: ${first.summary}` : "";
  return `Verification failed for "${first?.command ?? "unknown"}" (${exit})${summary}${suffix}.`;
}

function checkRunLimits(
  limits: RunLimits | undefined,
  facts: RunLimitFacts
): RunLimitExceededError | undefined {
  if (!limits) {
    return undefined;
  }

  const violations: RunLimitViolation[] = [];
  const turns = observedTurns(facts.events);
  if (limits.maxTurns !== undefined && turns > limits.maxTurns) {
    violations.push({
      actual: turns,
      limit: "maxTurns",
      max: limits.maxTurns,
      unit: "turns"
    });
  }

  if (limits.maxDurationMs !== undefined && facts.durationMs > limits.maxDurationMs) {
    violations.push({
      actual: facts.durationMs,
      limit: "maxDurationMs",
      max: limits.maxDurationMs,
      unit: "ms"
    });
  }

  const estimatedCostUsd =
    facts.usage?.estimatedCostUsd ?? lastEstimatedCostUsd(facts.events);
  if (
    estimatedCostUsd !== undefined &&
    limits.maxCostUsd !== undefined &&
    estimatedCostUsd > limits.maxCostUsd
  ) {
    violations.push({
      actual: estimatedCostUsd,
      limit: "maxCostUsd",
      max: limits.maxCostUsd,
      unit: "usd"
    });
  }

  const filesChanged = observedFilesChanged(facts.filesChanged, facts.events, facts.diff);
  if (limits.maxFilesChanged !== undefined && filesChanged > limits.maxFilesChanged) {
    violations.push({
      actual: filesChanged,
      limit: "maxFilesChanged",
      max: limits.maxFilesChanged,
      unit: "files"
    });
  }

  const diffBytes = facts.diff ? Buffer.byteLength(facts.diff, "utf8") : 0;
  if (limits.maxDiffBytes !== undefined && diffBytes > limits.maxDiffBytes) {
    violations.push({
      actual: diffBytes,
      limit: "maxDiffBytes",
      max: limits.maxDiffBytes,
      unit: "bytes"
    });
  }

  return violations.length > 0 ? new RunLimitExceededError(violations) : undefined;
}

function checkObservableCommandPolicy(
  evaluateCommand: ((command: string) => CommandPolicyEvaluation) | undefined,
  events: PortableRunEvent[]
): CommandPolicyViolationError | undefined {
  if (!evaluateCommand) {
    return undefined;
  }

  const checkedCommands = new Set<string>();
  for (const event of events) {
    if (event.type !== "command.started" && event.type !== "command.finished") {
      continue;
    }
    if (checkedCommands.has(event.command)) {
      continue;
    }
    checkedCommands.add(event.command);

    const evaluation = evaluateCommand(event.command);
    if (evaluation.decision === "allow") {
      continue;
    }
    const violation: CommandPolicyViolation = {
      command: event.command,
      decision: evaluation.decision,
      eventId: event.id,
      reason: evaluation.reason
    };
    if (evaluation.matchedRule) {
      violation.matchedRule = evaluation.matchedRule;
    }
    return new CommandPolicyViolationError(violation);
  }
  return undefined;
}

function createSyntheticRunStartedEvent(
  input: CreateSyntheticRunStartedEventInput
): PortableRunEvent {
  const seq = input.nextSeq();
  return {
    id: createEventId(input.runId, seq),
    input: {
      cwd: input.cwd,
      mode: input.input.mode ?? "edit",
      taskHash: hashTask(input.input.task)
    },
    provider: input.provider,
    runId: input.runId,
    seq,
    sessionId: input.sessionId,
    ts: new Date().toISOString(),
    type: "run.started"
  };
}

function createSyntheticRunCompletedEvent(
  input: CreateSyntheticRunCompletedEventInput
): PortableRunEvent {
  const seq = input.nextSeq();
  const result: Partial<RunResult> = {
    status: input.result.status
  };
  if (input.result.finalMessage) {
    result.finalMessage = input.result.finalMessage;
  }
  if (input.result.patchPath) {
    result.patchPath = input.result.patchPath;
  }
  if (input.result.usage) {
    result.usage = input.result.usage;
  }

  return {
    id: createEventId(input.runId, seq),
    ...(input.result.finalMessage ? { finalMessage: input.result.finalMessage } : {}),
    provider: input.provider,
    result,
    runId: input.runId,
    seq,
    sessionId: input.sessionId,
    status: input.result.status,
    ts: new Date().toISOString(),
    type: "run.completed"
  };
}

function createCommandPolicyFailureEvents(
  input: CreateCommandPolicyFailureEventsInput
): PortableRunEvent[] {
  const ts = new Date().toISOString();
  const statusSeq = input.nextSeq();
  const errorSeq = input.nextSeq();
  const completedSeq = input.nextSeq();
  const completedResult: Partial<RunResult> = {
    finalMessage: input.error.message,
    status: "failed"
  };
  if (input.result.patchPath) {
    completedResult.patchPath = input.result.patchPath;
  }
  if (input.result.usage) {
    completedResult.usage = input.result.usage;
  }

  return [
    {
      id: createEventId(input.runId, statusSeq),
      message: input.error.message,
      provider: input.provider,
      runId: input.runId,
      seq: statusSeq,
      sessionId: input.sessionId,
      severity: "error",
      status: "failed",
      ts,
      type: "run.status"
    },
    {
      error: {
        cause: {
          violation: input.error.violation
        },
        code: input.error.code,
        message: input.error.message
      },
      id: createEventId(input.runId, errorSeq),
      provider: input.provider,
      runId: input.runId,
      seq: errorSeq,
      sessionId: input.sessionId,
      severity: "error",
      ts,
      type: "error"
    },
    {
      finalMessage: input.error.message,
      id: createEventId(input.runId, completedSeq),
      provider: input.provider,
      result: completedResult,
      runId: input.runId,
      seq: completedSeq,
      sessionId: input.sessionId,
      severity: "error",
      status: "failed",
      ts,
      type: "run.completed"
    }
  ];
}

function createLimitFailureEvents(
  input: CreateLimitFailureEventsInput
): PortableRunEvent[] {
  const ts = new Date().toISOString();
  const statusSeq = input.nextSeq();
  const errorSeq = input.nextSeq();
  const completedSeq = input.nextSeq();
  const completedResult: Partial<RunResult> = {
    finalMessage: input.error.message,
    status: "failed"
  };
  if (input.result.patchPath) {
    completedResult.patchPath = input.result.patchPath;
  }
  if (input.result.usage) {
    completedResult.usage = input.result.usage;
  }

  return [
    {
      id: createEventId(input.runId, statusSeq),
      message: input.error.message,
      provider: input.provider,
      runId: input.runId,
      seq: statusSeq,
      sessionId: input.sessionId,
      severity: "error",
      status: "failed",
      ts,
      type: "run.status"
    },
    {
      error: {
        cause: {
          violations: input.error.violations
        },
        code: input.error.code,
        message: input.error.message
      },
      id: createEventId(input.runId, errorSeq),
      provider: input.provider,
      runId: input.runId,
      seq: errorSeq,
      sessionId: input.sessionId,
      severity: "error",
      ts,
      type: "error"
    },
    {
      finalMessage: input.error.message,
      id: createEventId(input.runId, completedSeq),
      provider: input.provider,
      result: completedResult,
      runId: input.runId,
      seq: completedSeq,
      sessionId: input.sessionId,
      severity: "error",
      status: "failed",
      ts,
      type: "run.completed"
    }
  ];
}

function lastEstimatedCostUsd(events: PortableRunEvent[]): number | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.type === "usage.updated" &&
      typeof event.usage.estimatedCostUsd === "number"
    ) {
      return event.usage.estimatedCostUsd;
    }
  }
  return undefined;
}

function observedFilesChanged(
  workspaceFilesChanged: number,
  events: PortableRunEvent[],
  diff: string | undefined
): number {
  const eventPaths = new Set<string>();
  for (const event of events) {
    if (event.type === "file.change.finished") {
      eventPaths.add(event.path);
    }
  }
  return Math.max(workspaceFilesChanged, eventPaths.size, countFilesInUnifiedDiff(diff));
}

function observedTurns(events: PortableRunEvent[]): number {
  return events.filter((event) => event.type === "assistant.message.completed").length;
}

function countFilesInUnifiedDiff(diff: string | undefined): number {
  if (!diff) {
    return 0;
  }
  const paths = new Set<string>();
  for (const line of diff.split("\n")) {
    const gitMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (gitMatch?.[2]) {
      paths.add(gitMatch[2]);
      continue;
    }
    if (line.startsWith("+++ b/")) {
      paths.add(line.slice("+++ b/".length));
    }
  }
  return paths.size;
}

function mergeWorkspaceConfig(
  base: WorkspaceConfig,
  override?: Partial<WorkspaceConfig>
): WorkspaceConfig {
  const cwd = override?.cwd ?? base.cwd;
  const merged: WorkspaceConfig = {
    ...base,
    ...override,
    cwd
  };
  if (base.git || override?.git) {
    merged.git = {
      ...(base.git ?? {}),
      ...(override?.git ?? {})
    };
  }
  return merged;
}

async function readImportedLedger(path: string): Promise<SessionLedger> {
  const ledgerPath = resolve(path);
  let content;
  try {
    content = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new LedgerImportError(
        [
          `Ledger import file not found: ${ledgerPath}`,
          "Pass a SessionLedger object or a readable JSON path. Relative paths are resolved from the current process working directory."
        ].join("\n"),
        { path: ledgerPath },
        "LEDGER_IMPORT_NOT_FOUND"
      );
    }
    throw new LedgerImportError(
      `Unable to read ledger import file "${ledgerPath}": ${formatUnknownError(error)}`,
      { path: ledgerPath }
    );
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new LedgerImportError(
      `Ledger import file is not valid JSON: ${ledgerPath}`,
      { path: ledgerPath },
      "LEDGER_IMPORT_INVALID"
    );
  }

  const parsedLedger = sessionLedgerSchema.safeParse(parsedJson);
  if (!parsedLedger.success) {
    throw new LedgerImportError(
      [
        `Ledger import file does not match the SessionLedger schema: ${ledgerPath}`,
        ...parsedLedger.error.issues.map((issue) => {
          const path = issue.path.length > 0 ? issue.path.join(".") : "ledger";
          return `  - ${path}: ${issue.message}`;
        })
      ].join("\n"),
      { path: ledgerPath },
      "LEDGER_IMPORT_INVALID"
    );
  }

  return parsedJson as SessionLedger;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function buildResumeSessionConfig(
  provider: ProviderId,
  config: HarnessConfig,
  overrides: Partial<ResumeSessionConfig>
): Promise<ResumeSessionConfig> {
  const providerConfig = config.providers?.[provider];
  const resume: ResumeSessionConfig = {
    provider,
    workspace: {
      ...config.workspace,
      ...overrides.workspace
    }
  };
  if (overrides.sessionId) {
    resume.sessionId = overrides.sessionId;
  }
  const nativeSessionId =
    overrides.nativeSessionId ?? nativeSessionIdFromLedger(provider, overrides.ledger);
  if (nativeSessionId) {
    resume.nativeSessionId = nativeSessionId;
  }
  if (overrides.ledger) {
    resume.ledger = overrides.ledger;
  }
  const ledgerProvider = ledgerProviderFor(provider, overrides.ledger);
  const model = overrides.model ?? ledgerProvider?.model ?? providerConfig?.model;
  if (model) {
    resume.model = model;
  }
  const runtime = overrides.runtime ?? ledgerProvider?.runtime ?? providerConfig?.runtime;
  if (runtime) {
    resume.runtime = runtime;
  }
  const apiKeyEnv = overrides.apiKeyEnv ?? providerConfig?.apiKeyEnv;
  if (apiKeyEnv) {
    resume.apiKeyEnv = apiKeyEnv;
  }
  resume.auth = {
    ...(providerConfig?.auth ?? {}),
    ...(overrides.auth ?? {})
  };
  resume.native = mergeNativeForProvider(
    provider,
    providerConfig?.native,
    overrides.native
  );
  if (providerConfig) {
    resume.providerConfig = providerConfig;
  }
  return resume;
}

function ledgerProviderFor(
  provider: ProviderId,
  ledger: SessionLedger | undefined
): SessionLedger["provider"] | undefined {
  return ledger?.provider.id === provider ? ledger.provider : undefined;
}

function nativeSessionIdFromLedger(
  provider: ProviderId,
  ledger: SessionLedger | undefined
): string | undefined {
  return ledgerProviderFor(provider, ledger)?.nativeSessionId;
}
