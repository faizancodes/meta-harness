import { execFile } from "node:child_process";
import { GitCommandError } from "./errors.js";
import { redactValue } from "./redact.js";

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunGitOptions {
  allowFailure?: boolean;
  maxBuffer?: number;
}

const ignoredUntrackedPathRoots = new Set([".harness", "node_modules"]);

export async function runGit(
  cwd: string,
  args: readonly string[],
  options: RunGitOptions = {}
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...args],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: options.maxBuffer ?? 50 * 1024 * 1024,
        shell: false
      },
      (error, stdout, stderr) => {
        const exitCode = error ? exitCodeFromError(error) : 0;
        const result: GitResult = {
          exitCode,
          stderr: String(stderr ?? ""),
          stdout: String(stdout ?? "")
        };

        if (!error || options.allowFailure) {
          resolve(result);
          return;
        }

        reject(
          new GitCommandError(
            `git ${args.join(" ")} failed with exit code ${exitCode}.`,
            {
              args: [...args],
              cwd,
              exitCode,
              stderr: redactValue(result.stderr) as string,
              stdout: redactValue(result.stdout) as string
            }
          )
        );
      }
    );
  });
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], {
    allowFailure: true
  });
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

export async function gitRoot(cwd: string): Promise<string | undefined> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"], {
    allowFailure: true
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

export async function gitHead(cwd: string): Promise<string | undefined> {
  const result = await runGit(cwd, ["rev-parse", "HEAD"], {
    allowFailure: true
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

export async function gitBranch(cwd: string): Promise<string | undefined> {
  const result = await runGit(cwd, ["branch", "--show-current"], {
    allowFailure: true
  });
  if (result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

export async function gitDirty(cwd: string): Promise<boolean> {
  const result = await runGit(cwd, ["status", "--porcelain", "--untracked-files=all"]);
  return result.stdout.split("\n").some((line) => isDirtyStatusLine(line));
}

export async function gitDiff(cwd: string): Promise<string> {
  const [tracked, untrackedFiles] = await Promise.all([
    runGit(cwd, ["diff", "--no-ext-diff", "--binary"], {
      maxBuffer: 100 * 1024 * 1024
    }),
    gitUntrackedFiles(cwd)
  ]);
  const untracked = await gitUntrackedDiff(cwd, untrackedFiles);
  return joinGitOutputs([tracked.stdout, untracked]);
}

export async function gitNumstat(cwd: string): Promise<string> {
  const [tracked, untrackedFiles] = await Promise.all([
    runGit(cwd, ["diff", "--numstat"], {
      maxBuffer: 50 * 1024 * 1024
    }),
    gitUntrackedFiles(cwd)
  ]);
  const untracked = await gitUntrackedNumstat(cwd, untrackedFiles);
  return joinGitOutputs([tracked.stdout, untracked]);
}

export async function gitUntrackedFiles(cwd: string): Promise<string[]> {
  const result = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return result.stdout
    .split("\0")
    .filter((path) => path.length > 0)
    .filter(shouldCaptureUntrackedPath)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function gitUntrackedDiff(cwd: string, files: readonly string[]): Promise<string> {
  const outputs: string[] = [];
  for (const file of files) {
    const args = ["diff", "--no-index", "--binary", "--", "/dev/null", file];
    const result = await runGit(cwd, args, {
      allowFailure: true,
      maxBuffer: 100 * 1024 * 1024
    });
    assertNoIndexDiffResult(cwd, args, result);
    outputs.push(result.stdout);
  }
  return joinGitOutputs(outputs);
}

async function gitUntrackedNumstat(
  cwd: string,
  files: readonly string[]
): Promise<string> {
  const outputs: string[] = [];
  for (const file of files) {
    const args = ["diff", "--no-index", "--numstat", "--", "/dev/null", file];
    const result = await runGit(cwd, args, {
      allowFailure: true,
      maxBuffer: 50 * 1024 * 1024
    });
    assertNoIndexDiffResult(cwd, args, result);
    outputs.push(result.stdout);
  }
  return joinGitOutputs(outputs);
}

function assertNoIndexDiffResult(
  cwd: string,
  args: readonly string[],
  result: GitResult
): void {
  if (result.exitCode <= 1) {
    return;
  }

  throw new GitCommandError(
    `git ${args.join(" ")} failed with exit code ${result.exitCode}.`,
    {
      args: [...args],
      cwd,
      exitCode: result.exitCode,
      stderr: redactValue(result.stderr) as string,
      stdout: redactValue(result.stdout) as string
    }
  );
}

function shouldCaptureUntrackedPath(path: string): boolean {
  const [root] = path.split("/");
  return root !== undefined && !ignoredUntrackedPathRoots.has(root);
}

function isDirtyStatusLine(line: string): boolean {
  if (!line.trim()) {
    return false;
  }
  if (!line.startsWith("?? ")) {
    return true;
  }
  return shouldCaptureUntrackedPath(line.slice(3));
}

function joinGitOutputs(outputs: readonly string[]): string {
  return outputs
    .filter((output) => output.length > 0)
    .map((output) => (output.endsWith("\n") ? output : `${output}\n`))
    .join("");
}

function exitCodeFromError(error: Error): number {
  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === "number") {
    return maybeCode;
  }
  return 1;
}
