import type { ProviderId } from "./types/adapter.js";
import type { RunLimits } from "./types/run.js";

export class HarnessError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "HarnessError";
  }
}

export class HarnessInputError extends HarnessError {
  constructor(message: string, code = "HARNESS_INPUT_INVALID") {
    super(message, code);
    this.name = "HarnessInputError";
  }
}

export class ProviderConfigError extends HarnessError {
  public readonly details: {
    option?: string;
    provider: ProviderId;
  };

  constructor(
    provider: ProviderId,
    message: string,
    code = "PROVIDER_CONFIG_INVALID",
    details: {
      option?: string;
    } = {}
  ) {
    super(message, code);
    this.name = "ProviderConfigError";
    this.details = {
      provider,
      ...details
    };
  }
}

export class AdapterNotFoundError extends HarnessError {
  constructor(provider: ProviderId) {
    super(`No adapter registered for provider "${provider}".`, "ADAPTER_NOT_FOUND");
    this.name = "AdapterNotFoundError";
  }
}

export class UnsupportedCapabilityError extends HarnessError {
  constructor(
    provider: ProviderId,
    public readonly capability: string,
    message = `Provider "${provider}" does not support capability "${capability}".`
  ) {
    super(message, "UNSUPPORTED_CAPABILITY");
    this.name = "UnsupportedCapabilityError";
  }
}

export interface CommandPolicyViolation {
  command: string;
  decision: "deny" | "approval_required";
  eventId: string;
  matchedRule?: string;
  reason: string;
}

export class CommandPolicyViolationError extends HarnessError {
  constructor(public readonly violation: CommandPolicyViolation) {
    super(formatCommandPolicyMessage(violation), "COMMAND_POLICY_VIOLATION");
    this.name = "CommandPolicyViolationError";
  }
}

export type RunLimitKey = keyof RunLimits;

export interface RunLimitViolation {
  limit: RunLimitKey;
  actual: number;
  max: number;
  unit: "bytes" | "files" | "ms" | "turns" | "usd";
}

export class RunLimitExceededError extends HarnessError {
  constructor(public readonly violations: RunLimitViolation[]) {
    super(formatRunLimitMessage(violations), "RUN_LIMIT_EXCEEDED");
    this.name = "RunLimitExceededError";
  }
}

export class EventValidationError extends HarnessError {
  constructor(message: string) {
    super(message, "EVENT_VALIDATION_ERROR");
    this.name = "EventValidationError";
  }
}

export class EventLogReadError extends HarnessError {
  constructor(
    message: string,
    public readonly details: {
      line?: number;
      path: string;
      runId: string;
    },
    code = "EVENT_LOG_READ_ERROR"
  ) {
    super(message, code);
    this.name = "EventLogReadError";
  }
}

export class RunArtifactError extends HarnessError {
  constructor(
    message: string,
    public readonly details: {
      artifact: "ledger" | "result";
      path: string;
      runId: string;
    },
    code = "RUN_ARTIFACT_ERROR"
  ) {
    super(message, code);
    this.name = "RunArtifactError";
  }
}

export class LedgerImportError extends HarnessError {
  constructor(
    message: string,
    public readonly details: {
      path: string;
    },
    code = "LEDGER_IMPORT_ERROR"
  ) {
    super(message, code);
    this.name = "LedgerImportError";
  }
}

function formatRunLimitMessage(violations: RunLimitViolation[]): string {
  const details = violations
    .map(
      (violation) =>
        `${violation.limit} ${formatLimitValue(
          violation.actual,
          violation.unit
        )} exceeded ${formatLimitValue(violation.max, violation.unit)}`
    )
    .join("; ");
  return `Run exceeded configured metaharness limits: ${details}.`;
}

function formatCommandPolicyMessage(violation: CommandPolicyViolation): string {
  return `Observed command "${violation.command}" violated metaharness command policy: ${violation.reason}`;
}

function formatLimitValue(value: number, unit: RunLimitViolation["unit"]): string {
  if (unit === "usd") {
    return `$${value.toFixed(4)}`;
  }
  return `${Math.round(value)} ${unit}`;
}

export class WorkspaceError extends HarnessError {
  constructor(message: string, code = "WORKSPACE_ERROR") {
    super(message, code);
    this.name = "WorkspaceError";
  }
}

export type WorkspaceSnapshotOperation = "read_directory" | "read_file" | "stat_file";

export class WorkspaceSnapshotError extends WorkspaceError {
  constructor(
    message: string,
    public readonly details: {
      operation: WorkspaceSnapshotOperation;
      path: string;
      root: string;
    }
  ) {
    super(message, "WORKSPACE_SNAPSHOT_ERROR");
    this.name = "WorkspaceSnapshotError";
  }
}

export class DirtyWorkspaceError extends WorkspaceError {
  constructor(cwd: string) {
    super(
      `Workspace "${cwd}" has uncommitted changes and requireClean is enabled.`,
      "DIRTY_WORKSPACE"
    );
    this.name = "DirtyWorkspaceError";
  }
}

export class GitCommandError extends WorkspaceError {
  constructor(
    message: string,
    public readonly details: {
      args: string[];
      cwd: string;
      exitCode?: number;
      stderr?: string;
      stdout?: string;
    }
  ) {
    super(message, "GIT_COMMAND_ERROR");
    this.name = "GitCommandError";
  }
}
