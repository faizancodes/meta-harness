import type { ProviderCapabilities } from "./capabilities.js";
import type { RunHandle, RunInput } from "./run.js";
import type { RunResult } from "./result.js";
import type { SessionLedger } from "./ledger.js";
import type {
  ResumeSessionConfig,
  SessionHandle,
  StartSessionConfig
} from "./session.js";
import type { PortableRunEvent } from "./events.js";

export type ProviderId = "mock" | "claude" | "cursor" | "codex";

export interface CapabilityProbeInput {
  cwd?: string;
  runtime?: "local" | "cloud" | "self-hosted";
  auth?: Record<string, string | undefined>;
}

export interface CodingAgentAdapter<TNativeSession = unknown, TNativeRun = unknown> {
  readonly provider: ProviderId;
  readonly version: string;
  capabilities(input?: CapabilityProbeInput): Promise<ProviderCapabilities>;
  startSession(config: StartSessionConfig): Promise<SessionHandle<TNativeSession>>;
  resumeSession(config: ResumeSessionConfig): Promise<SessionHandle<TNativeSession>>;
  run(
    session: SessionHandle<TNativeSession>,
    input: RunInput
  ): Promise<RunHandle<TNativeRun>>;
  stream(run: RunHandle<TNativeRun>): AsyncIterable<PortableRunEvent>;
  wait(run: RunHandle<TNativeRun>): Promise<RunResult>;
  cancel(run: RunHandle<TNativeRun>): Promise<void>;
  snapshot?(session: SessionHandle<TNativeSession>): Promise<Partial<SessionLedger>>;
  dispose?(): Promise<void>;
}
