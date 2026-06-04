import { MockAdapter } from "@metaharness/adapter-mock";
import { ClaudeAdapter } from "@metaharness/claude";
import { CodexAdapter } from "@metaharness/codex";
import { createHarness } from "@metaharness/core";
import { CursorAdapter } from "@metaharness/cursor";
import { initializeTelemetry } from "@metaharness/telemetry";
import type { CodingAgentAdapter, HarnessConfig } from "@metaharness/core";
import type { TelemetryHandle } from "@metaharness/telemetry";

let telemetryHandle: TelemetryHandle | undefined;

export function createCliHarness(config: HarnessConfig) {
  initializeCliTelemetry(config);
  return createHarness(config, createCliAdapters());
}

export async function shutdownCliTelemetry(): Promise<void> {
  const handle = telemetryHandle;
  telemetryHandle = undefined;
  await handle?.shutdown();
}

export function createCliAdapters(): CodingAgentAdapter[] {
  return [
    new MockAdapter(),
    new ClaudeAdapter(),
    new CodexAdapter(),
    new CursorAdapter()
  ];
}

function initializeCliTelemetry(config: HarnessConfig): void {
  if (telemetryHandle) {
    return;
  }
  telemetryHandle = initializeTelemetry({
    ...(config.telemetry ?? {}),
    env: process.env
  });
}
