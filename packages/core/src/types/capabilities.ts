import type { ProviderId } from "./adapter.js";

export type CapabilityStability = "stable" | "beta" | "experimental" | "unknown";

export interface CapabilityFlag {
  supported: boolean;
  stability: CapabilityStability;
  notes?: string;
}

export interface ProviderCapabilities {
  provider: ProviderId;
  runtime: {
    local: CapabilityFlag;
    cloud: CapabilityFlag;
    selfHosted: CapabilityFlag;
  };
  lifecycle: {
    start: CapabilityFlag;
    stream: CapabilityFlag;
    wait: CapabilityFlag;
    cancel: CapabilityFlag;
    resume: CapabilityFlag;
    fork: CapabilityFlag;
  };
  workspace: {
    readFiles: CapabilityFlag;
    writeFiles: CapabilityFlag;
    runCommands: CapabilityFlag;
    gitDiff: CapabilityFlag;
    gitBranch: CapabilityFlag;
    openPullRequest: CapabilityFlag;
    artifacts: CapabilityFlag;
  };
  tools: {
    mcp: CapabilityFlag;
    skills: CapabilityFlag;
    subagents: CapabilityFlag;
    hooks: CapabilityFlag;
    webSearch: CapabilityFlag;
  };
  policy: {
    filesystemSandbox: CapabilityFlag;
    commandAllowDeny: CapabilityFlag;
    networkControl: CapabilityFlag;
    humanApprovals: CapabilityFlag;
    providerNativePermissions: CapabilityFlag;
  };
  observability: {
    tokenUsage: CapabilityFlag;
    cost: CapabilityFlag;
    planEvents: CapabilityFlag;
    diffEvents: CapabilityFlag;
    commandEvents: CapabilityFlag;
    fileChangeEvents: CapabilityFlag;
    toolCallEvents: CapabilityFlag;
    rawEventAccess: CapabilityFlag;
  };
  knownLimitations: string[];
  nativeVersion?: string;
}

export function capability(
  supported: boolean,
  stability: CapabilityStability,
  notes?: string
): CapabilityFlag {
  const flag: CapabilityFlag = { supported, stability };
  if (notes) {
    flag.notes = notes;
  }
  return flag;
}
