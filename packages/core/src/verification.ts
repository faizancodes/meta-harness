import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { redactValue } from "./redact.js";

export interface VerificationResult {
  command: string;
  exitCode?: number;
  outputPath?: string;
  summary?: string;
}

export async function runVerificationCommands(
  commands: readonly string[] | undefined,
  options: {
    cwd: string;
    outputPath: string;
    redactSecrets: boolean;
  }
): Promise<VerificationResult[]> {
  if (!commands || commands.length === 0) {
    await writeFile(options.outputPath, "No verification commands configured.\n", "utf8");
    return [];
  }

  const results: VerificationResult[] = [];
  const log: string[] = [];
  for (const command of commands) {
    log.push(`$ ${redactText(command, options.redactSecrets)}`);
    const parsed = parseVerificationCommand(command);
    if (!parsed.ok) {
      const result: VerificationResult = {
        command,
        exitCode: 1,
        outputPath: options.outputPath,
        summary: parsed.reason
      };
      results.push(result);
      log.push(parsed.reason, "");
      continue;
    }

    const executed = await execVerification(parsed.argv, options.cwd);
    const stdout = redactText(executed.stdout, options.redactSecrets);
    const stderr = redactText(executed.stderr, options.redactSecrets);
    if (stdout) {
      log.push(stdout.trimEnd());
    }
    if (stderr) {
      log.push(stderr.trimEnd());
    }
    log.push(`exit ${executed.exitCode}`, "");

    const result: VerificationResult = {
      command,
      exitCode: executed.exitCode,
      outputPath: options.outputPath
    };
    const summary = summarizeVerificationOutput(stdout, stderr, executed.exitCode);
    if (summary) {
      result.summary = summary;
    }
    results.push(result);
  }

  await writeFile(options.outputPath, `${log.join("\n")}\n`, "utf8");
  return results;
}

export function parseVerificationCommand(command: string):
  | {
      argv: string[];
      ok: true;
    }
  | {
      ok: false;
      reason: string;
    } {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: "Verification command is empty."
    };
  }

  const argv: string[] = [];
  let current = "";
  let escaped = false;
  let quote: "'" | '"' | undefined;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index] ?? "";
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (isShellOperatorAt(trimmed, index)) {
      return {
        ok: false,
        reason:
          "Verification command contains shell operators; metaharness verification requires a direct argv command."
      };
    }
    if (/\s/.test(char)) {
      if (current) {
        argv.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (quote) {
    return {
      ok: false,
      reason: "Verification command contains an unterminated quote."
    };
  }
  if (current) {
    argv.push(current);
  }
  if (argv.length === 0) {
    return {
      ok: false,
      reason: "Verification command is empty."
    };
  }
  if (invokesInlineShell(argv)) {
    return {
      ok: false,
      reason:
        "Verification command invokes a shell with inline code; metaharness verification requires a direct argv command."
    };
  }
  return {
    argv,
    ok: true
  };
}

async function execVerification(
  argv: readonly string[],
  cwd: string
): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const [file, ...args] = argv;
  return new Promise((resolve) => {
    execFile(
      file ?? "",
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
        shell: false
      },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? exitCodeFromError(error) : 0,
          stderr: String(stderr ?? ""),
          stdout: String(stdout ?? "")
        });
      }
    );
  });
}

function summarizeVerificationOutput(
  stdout: string,
  stderr: string,
  exitCode: number
): string {
  const text = `${stdout}\n${stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  return text ? text.slice(0, 500) : `exit ${exitCode}`;
}

function redactText(value: string, enabled: boolean): string {
  return redactValue(value, {
    enabled
  }) as string;
}

function exitCodeFromError(error: Error): number {
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "number" ? maybeCode : 1;
}

function isShellOperatorAt(value: string, index: number): boolean {
  const char = value[index];
  if (!char) {
    return false;
  }
  if (char === "&" || char === "|" || char === ";" || char === "<" || char === ">") {
    return true;
  }
  if (char === "`" || char === "$" || char === "(" || char === ")") {
    return true;
  }
  return false;
}

function invokesInlineShell(argv: readonly string[]): boolean {
  const executable = argv[0]?.split(/[\\/]/).at(-1)?.toLowerCase();
  if (!executable || !shellExecutables.has(executable)) {
    return false;
  }
  return argv.some((arg) => arg === "-c" || arg === "/c" || arg === "/C");
}

const shellExecutables = new Set([
  "bash",
  "cmd",
  "cmd.exe",
  "dash",
  "fish",
  "ksh",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "sh",
  "zsh"
]);
