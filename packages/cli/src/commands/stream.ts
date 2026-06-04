import { resolve } from "node:path";
import { FileEventRecorder, FileRunStore } from "@metaharness/core";
import { loadConfig } from "../load-config.js";
import { renderEvent } from "../render/console-events.js";
import {
  assertRunArtifactDirectory,
  assertRunArtifactFile,
  requireRunId,
  resolveRunIdAlias
} from "../run-artifacts.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import type { CliIO, GlobalOptions } from "../types.js";

export interface StreamOptions extends GlobalOptions {
  raw?: boolean;
}

export async function streamCommand(
  runId: string | undefined,
  options: StreamOptions,
  io: CliIO
): Promise<void> {
  const requestedRunId = requireRunId(runId, "hk stream");
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const config = await loadConfig(
    options.config ? { configPath: options.config, cwd } : { cwd }
  );
  const store = new FileRunStore(config);
  const resolvedRunId = await resolveRunIdAlias({
    commandName: "hk stream",
    runId: requestedRunId,
    runsRoot: resolve(store.rootDir, "runs")
  });
  const paths = store.paths(resolvedRunId);
  await assertRunArtifactDirectory({
    path: paths.runDir,
    runId: resolvedRunId
  });
  await assertRunArtifactFile({
    guidance: options.raw
      ? "Raw events are written only when --raw-events, RunInput.rawEvents, or config rawEvents is enabled."
      : "Run event logs are written as events.ndjson when a run starts.",
    label: options.raw ? "Raw event log" : "Event log",
    path: options.raw ? paths.rawEvents : paths.events,
    runId: resolvedRunId
  });
  const recorder = new FileEventRecorder({
    eventsPath: options.raw ? paths.rawEvents : paths.events,
    rawEventsPath: paths.rawEvents,
    rawEvents: options.raw ?? false,
    redactSecrets: true
  });

  for await (const event of recorder.read(resolvedRunId)) {
    io.stdout.write(`${options.raw ? JSON.stringify(event) : renderEvent(event)}\n`);
  }
}
