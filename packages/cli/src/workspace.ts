import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { HarnessError } from "@metaharness/core";

export async function resolveWorkspaceCwd(cwd = process.cwd()): Promise<string> {
  const workspace = resolve(cwd);
  let workspaceStat;
  try {
    workspaceStat = await stat(workspace);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new HarnessError(
        [
          `Workspace directory does not exist: ${workspace}`,
          "Create it first or pass --cwd <existing-directory>."
        ].join("\n"),
        "WORKSPACE_NOT_FOUND"
      );
    }
    throw new HarnessError(
      `Unable to inspect workspace path "${workspace}": ${formatError(error)}`,
      "WORKSPACE_READ_ERROR"
    );
  }

  if (!workspaceStat.isDirectory()) {
    throw new HarnessError(
      [
        `Workspace path is not a directory: ${workspace}`,
        "Pass --cwd <existing-directory>."
      ].join("\n"),
      "WORKSPACE_NOT_DIRECTORY"
    );
  }

  return workspace;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
