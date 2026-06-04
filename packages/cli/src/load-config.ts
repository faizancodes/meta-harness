import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { HarnessError, validateHarnessConfig } from "@metaharness/core";
import { resolveWorkspaceCwd } from "./workspace.js";
import type { HarnessConfig } from "@metaharness/core";

export async function loadConfig(input: {
  configPath?: string;
  cwd: string;
}): Promise<HarnessConfig> {
  const cwd = await resolveWorkspaceCwd(input.cwd);
  const configPath = resolve(cwd, input.configPath ?? "metaharness.config.ts");
  const isDefaultConfigPath = input.configPath === undefined;
  try {
    const configStats = await stat(configPath);
    if (!configStats.isFile()) {
      throw new HarnessError(
        `Config path is not a file: ${configPath}. Pass --config <file> or omit --config to use metaharness.config.ts.`,
        "CONFIG_PATH_INVALID"
      );
    }
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      if (isDefaultConfigPath) {
        return defaultCliConfig(cwd);
      }
      throw new HarnessError(
        `Config file not found: ${configPath}. --config is resolved relative to --cwd.`,
        "CONFIG_NOT_FOUND"
      );
    }
    if (error instanceof HarnessError) {
      throw error;
    }
    throw new HarnessError(
      `Unable to read config file "${configPath}": ${formatError(error)}`,
      "CONFIG_READ_ERROR"
    );
  }

  const previousCwd = process.cwd();
  let imported: {
    default?: unknown;
  };
  try {
    process.chdir(cwd);
    imported = (await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)) as {
      default?: unknown;
    };
  } catch (error) {
    throw new HarnessError(
      [
        `Failed to import config file "${configPath}": ${formatError(error)}`,
        "Keep metaharness.config.ts as plain ESM and avoid runtime imports unless the package is installed in the target workspace."
      ].join("\n"),
      "CONFIG_IMPORT_ERROR"
    );
  } finally {
    process.chdir(previousCwd);
  }
  return validateCliConfig(imported.default, configPath);
}

export function defaultCliConfig(cwd: string): HarnessConfig {
  return {
    defaultProvider: "mock",
    providers: {
      mock: {
        provider: "mock"
      }
    },
    storage: {
      rootDir: ".harness"
    },
    workspace: {
      cwd
    }
  };
}

function validateCliConfig(value: unknown, configPath: string): HarnessConfig {
  const validation = validateHarnessConfig(value);
  if (!validation.success && validation.reason === "not_object") {
    throw new HarnessError(
      `Config file "${configPath}" does not export a metaharness config object.`,
      "CONFIG_INVALID"
    );
  }

  if (!validation.success) {
    throw new HarnessError(
      [
        `Config file "${configPath}" is invalid:`,
        ...validation.diagnostics.map((item) => `  - ${item}`)
      ].join("\n"),
      "CONFIG_INVALID"
    );
  }

  return validation.config;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
