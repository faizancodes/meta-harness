import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { HarnessError } from "@metaharness/core";

export const latestRunAlias = "latest";

export interface RunArtifactDirectory {
  mtimeMs: number;
  runDir: string;
  runId: string;
}

export function requireRunId(value: string | undefined, commandName: string): string {
  if (!value) {
    throw new HarnessError(
      `Missing run id. Pass <run-id> or ${latestRunAlias} to ${commandName}.`,
      "RUN_ID_MISSING"
    );
  }
  return value;
}

export async function resolveRunIdAlias(input: {
  commandName: string;
  runId: string;
  runsRoot: string;
}): Promise<string> {
  if (input.runId !== latestRunAlias) {
    return input.runId;
  }

  const latestRunId = await findLatestRunId(input.runsRoot);
  if (latestRunId) {
    return latestRunId;
  }

  throw new HarnessError(
    [
      `No run artifacts found under ${input.runsRoot}.`,
      `Start a run first or pass an explicit run id to ${input.commandName}.`
    ].join("\n"),
    "RUN_ARTIFACT_NOT_FOUND"
  );
}

export async function listRunArtifactDirectories(
  runsRoot: string
): Promise<RunArtifactDirectory[]> {
  let entries;
  try {
    entries = await readdir(runsRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw new HarnessError(
      `Unable to read run artifacts under ${runsRoot}.`,
      "RUN_ARTIFACT_ERROR"
    );
  }

  const runDirectories: RunArtifactDirectory[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const runDir = resolve(runsRoot, entry.name);
    try {
      runDirectories.push({
        mtimeMs: (await stat(runDir)).mtimeMs,
        runDir,
        runId: entry.name
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw new HarnessError(
        `Unable to read run artifact directory "${runDir}".`,
        "RUN_ARTIFACT_ERROR"
      );
    }
  }

  return runDirectories.toSorted(compareRunDirectories);
}

export async function assertRunArtifactDirectory(input: {
  path: string;
  runId: string;
}): Promise<void> {
  let artifactStat;
  try {
    artifactStat = await stat(input.path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new HarnessError(
        [
          `Run artifacts not found for run "${input.runId}": ${input.path}`,
          "Check the run id, --cwd, --config, and storage.rootDir."
        ].join("\n"),
        "RUN_ARTIFACT_NOT_FOUND"
      );
    }
    throw new HarnessError(
      `Unable to read run artifacts for "${input.runId}": ${input.path}`,
      "RUN_ARTIFACT_ERROR"
    );
  }

  if (!artifactStat.isDirectory()) {
    throw new HarnessError(
      [
        `Run artifact path is not a directory for run "${input.runId}": ${input.path}`,
        "Check storage.rootDir and remove or rename the conflicting path."
      ].join("\n"),
      "RUN_ARTIFACT_INVALID"
    );
  }
}

export async function assertRunArtifactFile(input: {
  guidance?: string;
  label: string;
  path: string;
  runId: string;
}): Promise<void> {
  let artifactStat;
  try {
    artifactStat = await stat(input.path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new HarnessError(
        [
          `${input.label} not found for run "${input.runId}": ${input.path}`,
          input.guidance ?? "The run artifact directory exists, but this file is missing."
        ].join("\n"),
        "RUN_ARTIFACT_NOT_FOUND"
      );
    }
    throw new HarnessError(
      `Unable to read ${input.label.toLowerCase()} for run "${input.runId}": ${input.path}`,
      "RUN_ARTIFACT_ERROR"
    );
  }

  if (!artifactStat.isFile()) {
    throw new HarnessError(
      `${input.label} path is not a file for run "${input.runId}": ${input.path}`,
      "RUN_ARTIFACT_INVALID"
    );
  }
}

async function findLatestRunId(runsRoot: string): Promise<string | undefined> {
  return (await listRunArtifactDirectories(runsRoot))[0]?.runId;
}

function compareRunDirectories(
  left: Pick<RunArtifactDirectory, "mtimeMs" | "runId">,
  right: Pick<RunArtifactDirectory, "mtimeMs" | "runId">
): number {
  const mtimeOrder = right.mtimeMs - left.mtimeMs;
  return mtimeOrder === 0 ? right.runId.localeCompare(left.runId) : mtimeOrder;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
