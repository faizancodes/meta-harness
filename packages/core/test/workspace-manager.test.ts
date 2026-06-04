import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DirtyWorkspaceError,
  FileRunStore,
  FileWorkspaceManager,
  WorkspaceSnapshotError,
  parseNumstat
} from "../src/index.js";
import { createTinyGitRepo, pathExists, run } from "./git-fixtures.js";

describe("FileWorkspaceManager", () => {
  it("rejects missing workspace directories", async () => {
    const manager = new FileWorkspaceManager();

    await expect(
      manager.prepare({ cwd: join(tmpdir(), "does-not-exist") })
    ).rejects.toThrow(/does not exist/);
  });

  it("fails before provider startup when requireClean is enabled for a dirty repo", async () => {
    const repo = await createTinyGitRepo();
    await writeFile(repo.sourcePath, "export const value = 2;\n", "utf8");
    const manager = new FileWorkspaceManager();

    await expect(
      manager.prepare({
        cwd: repo.cwd,
        git: {
          requireClean: true
        }
      })
    ).rejects.toBeInstanceOf(DirtyWorkspaceError);
  });

  it("captures unified diff and numstat after file modification", async () => {
    const repo = await createTinyGitRepo();
    const runStore = new FileRunStore({
      workspace: {
        cwd: repo.cwd
      }
    });
    const manager = new FileWorkspaceManager(runStore);
    const prepared = await manager.prepare({
      cwd: repo.cwd
    });

    await writeFile(repo.sourcePath, "export const value = 3;\n", "utf8");

    const diff = await manager.diff(prepared);
    expect(diff.unifiedDiff).toContain("-export const value = 1;");
    expect(diff.unifiedDiff).toContain("+export const value = 3;");
    expect(diff.filesChanged).toBe(1);
    expect(diff.insertions).toBe(1);
    expect(diff.deletions).toBe(1);

    const patchPath = await manager.writePatch("run-1", diff.unifiedDiff);
    expect(await readFile(patchPath, "utf8")).toContain("+export const value = 3;");
  });

  it("captures untracked Git files without recording harness internals", async () => {
    const repo = await createTinyGitRepo();
    const runStore = new FileRunStore({
      workspace: {
        cwd: repo.cwd
      }
    });
    const manager = new FileWorkspaceManager(runStore);
    const prepared = await manager.prepare({
      cwd: repo.cwd
    });

    await writeFile(join(repo.cwd, "NEW.md"), "created\n", "utf8");
    await mkdir(join(repo.cwd, ".harness", "runs", "run-1"), {
      recursive: true
    });
    await writeFile(
      join(repo.cwd, ".harness", "runs", "run-1", "events.ndjson"),
      '{"type":"internal"}\n',
      "utf8"
    );

    const diff = await manager.diff(prepared);
    expect(diff.unifiedDiff).toContain("diff --git a/NEW.md b/NEW.md");
    expect(diff.unifiedDiff).toContain("new file mode");
    expect(diff.unifiedDiff).toContain("+created");
    expect(diff.unifiedDiff).not.toContain(".harness");
    expect(diff.filesChanged).toBe(1);
    expect(diff.insertions).toBe(1);
    expect(diff.deletions).toBe(0);

    const patchPath = await manager.writePatch("run-1", diff.unifiedDiff);
    const cleanRepo = await createTinyGitRepo();
    await run("git", ["apply", "--check", patchPath], cleanRepo.cwd);
  });

  it("ignores untracked harness storage when checking Git workspace dirtiness", async () => {
    const repo = await createTinyGitRepo();
    const manager = new FileWorkspaceManager();
    const prepared = await manager.prepare({
      cwd: repo.cwd
    });

    await mkdir(join(repo.cwd, ".harness", "runs", "run-1"), {
      recursive: true
    });
    await writeFile(
      join(repo.cwd, ".harness", "runs", "run-1", "events.ndjson"),
      '{"type":"internal"}\n',
      "utf8"
    );

    const snapshot = await manager.snapshot(prepared);
    const diff = await manager.diff(prepared);
    expect(snapshot.dirty).toBe(false);
    expect(diff.unifiedDiff).toBe("");
    expect(diff.filesChanged).toBe(0);
  });

  it("captures text diffs in non-git workspaces with a file snapshot fallback", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-non-git-diff-"));
    await mkdir(join(cwd, "src"), {
      recursive: true
    });
    await writeFile(join(cwd, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await writeFile(join(cwd, "remove.txt"), "remove me\n", "utf8");

    const manager = new FileWorkspaceManager();
    const prepared = await manager.prepare({
      cwd
    });
    const before = await manager.snapshot(prepared);

    await writeFile(join(cwd, "src", "index.ts"), "export const value = 2;\n", "utf8");
    await writeFile(join(cwd, "created.txt"), "created\n", "utf8");
    await rm(join(cwd, "remove.txt"));
    await mkdir(join(cwd, ".harness"), {
      recursive: true
    });
    await writeFile(join(cwd, ".harness", "ignored.txt"), "ignored\n", "utf8");

    const after = await manager.snapshot(prepared);
    const diff = await manager.diff(prepared);

    expect(before.dirty).toBe(false);
    expect(after.dirty).toBe(true);
    expect(diff.filesChanged).toBe(3);
    expect(diff.insertions).toBe(2);
    expect(diff.deletions).toBe(2);
    expect(diff.unifiedDiff).toContain(
      "diff --metaharness a/src/index.ts b/src/index.ts"
    );
    expect(diff.unifiedDiff).toContain("-export const value = 1;");
    expect(diff.unifiedDiff).toContain("+export const value = 2;");
    expect(diff.unifiedDiff).toContain("diff --metaharness /dev/null b/created.txt");
    expect(diff.unifiedDiff).toContain("+created");
    expect(diff.unifiedDiff).toContain("diff --metaharness a/remove.txt /dev/null");
    expect(diff.unifiedDiff).not.toContain(".harness");
  });

  it("wraps non-git snapshot filesystem failures with path context", async () => {
    if (typeof process.getuid !== "function" || process.getuid() === 0) {
      return;
    }

    const cwd = await mkdtemp(join(tmpdir(), "metaharness-snapshot-error-"));
    const unreadable = join(cwd, "private");
    await mkdir(unreadable);
    await chmod(unreadable, 0o000);

    try {
      const manager = new FileWorkspaceManager();

      await expect(manager.prepare({ cwd })).rejects.toMatchObject({
        code: "WORKSPACE_SNAPSHOT_ERROR",
        details: {
          operation: "read_directory",
          path: unreadable,
          root: cwd
        },
        name: "WorkspaceSnapshotError"
      });
      await expect(manager.prepare({ cwd })).rejects.toBeInstanceOf(
        WorkspaceSnapshotError
      );
    } finally {
      await chmod(unreadable, 0o700);
    }
  });

  it("creates and cleans up isolated worktrees", async () => {
    const repo = await createTinyGitRepo();
    const manager = new FileWorkspaceManager();
    const prepared = await manager.prepare({
      cwd: repo.cwd,
      git: {
        branchPrefix: "agent/",
        createWorktree: true,
        worktreeRoot: await mkdtemp(join(tmpdir(), "metaharness-worktrees-"))
      }
    });

    expect(prepared.cwd).not.toBe(repo.cwd);
    expect(prepared.branch).toMatch(/^agent\//);
    expect(await pathExists(prepared.cwd)).toBe(true);
    expect(await readFile(join(prepared.cwd, "src", "index.ts"), "utf8")).toContain(
      "value = 1"
    );

    await prepared.cleanup?.();
    expect(await pathExists(prepared.cwd)).toBe(false);
  });

  it("parses numstat without counting blank lines", () => {
    expect(parseNumstat("1\t2\tsrc/index.ts\n-\t-\tbinary.bin\n\n")).toEqual({
      deletions: 2,
      filesChanged: 2,
      insertions: 1
    });
  });
});
