#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export * from "./commands/compare.js";
export * from "./commands/docs.js";
export * from "./commands/doctor.js";
export * from "./commands/handoff.js";
export * from "./commands/init.js";
export * from "./commands/ledger.js";
export * from "./commands/policy.js";
export * from "./commands/resume.js";
export * from "./commands/run.js";
export * from "./commands/runs.js";
export * from "./commands/stream.js";
export * from "./harness.js";
export * from "./load-config.js";
export * from "./main.js";
export * from "./render/console-events.js";
export * from "./render/tables.js";
export * from "./types.js";
export type { HarnessConfig } from "@metaharness/core";

import { runCli } from "./main.js";

if (isCliEntrypoint()) {
  await runCli();
}

function isCliEntrypoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) {
    return false;
  }

  const entrypoint = fileURLToPath(import.meta.url);
  try {
    return realpathSync(resolve(invoked)) === realpathSync(entrypoint);
  } catch {
    return resolve(invoked) === entrypoint;
  }
}
