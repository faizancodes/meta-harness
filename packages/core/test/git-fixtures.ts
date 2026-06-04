import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TinyRepo {
  cwd: string;
  readSource(): Promise<string>;
  sourcePath: string;
}

export async function createTinyGitRepo(): Promise<TinyRepo> {
  const cwd = await mkdtemp(join(tmpdir(), "metaharness-git-"));
  await run("git", ["init"], cwd);
  await run("git", ["config", "user.email", "test@example.com"], cwd);
  await run("git", ["config", "user.name", "metaharness test"], cwd);
  await mkdir(join(cwd, "src"), { recursive: true });
  const sourcePath = join(cwd, "src", "index.ts");
  await writeFile(sourcePath, "export const value = 1;\n", "utf8");
  await run("git", ["add", "."], cwd);
  await run("git", ["commit", "-m", "initial"], cwd);

  return {
    cwd,
    readSource: () => readFile(sourcePath, "utf8"),
    sourcePath
  };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, encoding: "utf8", shell: false },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${command} ${args.join(" ")} failed: ${stderr}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}
