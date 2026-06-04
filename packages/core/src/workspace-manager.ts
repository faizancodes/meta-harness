import { randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import { access, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { DirtyWorkspaceError, WorkspaceError, WorkspaceSnapshotError } from "./errors.js";
import type { WorkspaceSnapshotOperation } from "./errors.js";
import {
  gitBranch,
  gitDiff,
  gitDirty,
  gitHead,
  gitNumstat,
  gitRoot,
  isGitRepository,
  runGit
} from "./git.js";
import type {
  WorkspaceFileSnapshot,
  WorkspaceFileSnapshotEntry,
  PreparedWorkspace,
  WorkspaceConfig,
  WorkspaceDiff,
  WorkspaceSnapshot
} from "./types/workspace.js";

const snapshotIgnoredDirectories = new Set([".git", ".harness", "node_modules"]);
const maxSnapshotFileBytes = 1024 * 1024;

export interface WorkspaceManager {
  prepare(config: WorkspaceConfig): Promise<PreparedWorkspace>;
  snapshot(workspace: PreparedWorkspace): Promise<WorkspaceSnapshot>;
  diff(workspace: PreparedWorkspace): Promise<WorkspaceDiff>;
  writePatch(runId: string, diff: string): Promise<string>;
}

export interface WorkspacePatchWriter {
  writePatch(runId: string, diff: string): Promise<string>;
}

export class FileWorkspaceManager implements WorkspaceManager {
  constructor(private readonly patchWriter?: WorkspacePatchWriter) {}

  async prepare(config: WorkspaceConfig): Promise<PreparedWorkspace> {
    await assertDirectory(config.cwd);

    if (!(await isGitRepository(config.cwd))) {
      if (config.git?.requireClean || config.git?.createWorktree) {
        throw new WorkspaceError(
          `Workspace "${config.cwd}" is not a Git repository.`,
          "GIT_REPOSITORY_REQUIRED"
        );
      }
      return {
        cwd: config.cwd,
        fileSnapshot: await createFileSnapshot(config.cwd)
      };
    }

    const root = await gitRoot(config.cwd);
    if (!root) {
      throw new WorkspaceError(`Unable to resolve Git root for "${config.cwd}".`);
    }

    const snapshot = await this.snapshot({
      cwd: root,
      gitRoot: root
    });

    if (config.git?.requireClean && snapshot.dirty) {
      throw new DirtyWorkspaceError(root);
    }

    if (config.git?.createWorktree) {
      return this.createWorktree(config, root, snapshot);
    }

    const prepared: PreparedWorkspace = {
      cwd: root,
      gitRoot: root
    };
    if (snapshot.commit) {
      prepared.startingCommit = snapshot.commit;
    }
    if (snapshot.branch) {
      prepared.branch = snapshot.branch;
    }
    return prepared;
  }

  async snapshot(workspace: PreparedWorkspace): Promise<WorkspaceSnapshot> {
    if (!workspace.gitRoot && !(await isGitRepository(workspace.cwd))) {
      return {
        dirty: workspace.fileSnapshot
          ? fileSnapshotsDiffer(
              workspace.fileSnapshot,
              await createFileSnapshot(workspace.cwd)
            )
          : false
      };
    }

    const commit = await gitHead(workspace.cwd);
    const branch = await gitBranch(workspace.cwd);
    const dirty = await gitDirty(workspace.cwd);
    const snapshot: WorkspaceSnapshot = {
      dirty
    };
    if (commit) {
      snapshot.commit = commit;
    }
    if (branch) {
      snapshot.branch = branch;
    }
    return snapshot;
  }

  async diff(workspace: PreparedWorkspace): Promise<WorkspaceDiff> {
    if (!workspace.gitRoot && !(await isGitRepository(workspace.cwd))) {
      if (workspace.fileSnapshot) {
        return diffFileSnapshots(
          workspace.fileSnapshot,
          await createFileSnapshot(workspace.cwd)
        );
      }
      return {
        filesChanged: 0,
        unifiedDiff: ""
      };
    }

    const unifiedDiff = await gitDiff(workspace.cwd);
    const stats = parseNumstat(await gitNumstat(workspace.cwd));
    return {
      unifiedDiff,
      ...stats
    };
  }

  async writePatch(runId: string, diff: string): Promise<string> {
    if (!this.patchWriter) {
      throw new WorkspaceError(
        "No patch writer was configured for this workspace manager."
      );
    }
    return this.patchWriter.writePatch(runId, diff);
  }

  private async createWorktree(
    config: WorkspaceConfig,
    gitRootPath: string,
    initialSnapshot: WorkspaceSnapshot
  ): Promise<PreparedWorkspace> {
    const baseRef = config.git?.baseRef ?? "HEAD";
    const branchPrefix = config.git?.branchPrefix ?? "agent/";
    const branchName = `${branchPrefix}${randomUUID()}`;
    const worktreeRoot = resolve(
      gitRootPath,
      config.git?.worktreeRoot ?? ".harness/worktrees"
    );
    const worktreePath = resolve(worktreeRoot, sanitizePathSegment(branchName));

    await mkdir(worktreeRoot, { recursive: true });
    await runGit(gitRootPath, [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      baseRef
    ]);

    const cleanup = async () => {
      await runGit(gitRootPath, ["worktree", "remove", "--force", worktreePath], {
        allowFailure: true
      });
      await rm(worktreePath, { force: true, recursive: true });
    };

    const prepared: PreparedWorkspace = {
      branch: branchName,
      cleanup,
      cwd: worktreePath,
      gitRoot: worktreePath
    };
    if (initialSnapshot.commit) {
      prepared.startingCommit = initialSnapshot.commit;
    }
    return prepared;
  }
}

export function parseNumstat(numstat: string): {
  deletions?: number;
  filesChanged: number;
  insertions?: number;
} {
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  for (const line of numstat.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [added, removed] = line.split("\t");
    filesChanged += 1;
    if (added && /^\d+$/.test(added)) {
      insertions += Number(added);
    }
    if (removed && /^\d+$/.test(removed)) {
      deletions += Number(removed);
    }
  }

  const stats: {
    deletions?: number;
    filesChanged: number;
    insertions?: number;
  } = {
    filesChanged
  };
  if (filesChanged > 0) {
    stats.insertions = insertions;
    stats.deletions = deletions;
  }
  return stats;
}

async function assertDirectory(path: string): Promise<void> {
  try {
    await access(path);
    const info = await stat(path);
    if (!info.isDirectory()) {
      throw new WorkspaceError(`Workspace path "${path}" is not a directory.`);
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError(`Workspace path "${path}" does not exist.`);
  }
}

function sanitizePathSegment(value: string): string {
  return basename(value.replace(/[^A-Za-z0-9._-]+/g, "-"));
}

async function createFileSnapshot(root: string): Promise<WorkspaceFileSnapshot> {
  const files: Record<string, WorkspaceFileSnapshotEntry> = {};
  await collectSnapshotFiles(root, files);
  return {
    files,
    root
  };
}

async function collectSnapshotFiles(
  root: string,
  files: Record<string, WorkspaceFileSnapshotEntry>,
  directory = root
): Promise<void> {
  const entries = await readSnapshotDirectory(root, directory);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (snapshotIgnoredDirectories.has(entry.name)) {
        continue;
      }
      await collectSnapshotFiles(root, files, absolutePath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const info = await statSnapshotFile(root, absolutePath);
    const path = normalizeSnapshotPath(root, absolutePath);
    if (info.size > maxSnapshotFileBytes) {
      files[path] = {
        kind: "binary",
        size: info.size
      };
      continue;
    }

    const content = await readSnapshotFile(root, absolutePath);
    if (content.includes(0)) {
      files[path] = {
        kind: "binary",
        size: info.size
      };
      continue;
    }

    files[path] = {
      content: content.toString("utf8"),
      kind: "text",
      size: info.size
    };
  }
}

async function readSnapshotDirectory(root: string, directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, {
      withFileTypes: true
    });
  } catch (error) {
    throw workspaceSnapshotError(root, directory, "read_directory", error);
  }
}

async function statSnapshotFile(root: string, path: string): Promise<Stats> {
  try {
    return await stat(path);
  } catch (error) {
    throw workspaceSnapshotError(root, path, "stat_file", error);
  }
}

async function readSnapshotFile(root: string, path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    throw workspaceSnapshotError(root, path, "read_file", error);
  }
}

function workspaceSnapshotError(
  root: string,
  path: string,
  operation: WorkspaceSnapshotOperation,
  error: unknown
): WorkspaceSnapshotError {
  const relativePath = normalizeSnapshotPath(root, path);
  const displayPath = relativePath.length > 0 ? relativePath : ".";
  return new WorkspaceSnapshotError(
    [
      `Unable to snapshot workspace "${root}": ${formatSnapshotOperation(
        operation
      )} "${displayPath}" failed.`,
      `Fix file permissions, remove the unreadable path, or run from a Git repository with ignored generated files excluded.`,
      `Cause: ${formatError(error)}`
    ].join(" "),
    {
      operation,
      path,
      root
    }
  );
}

function formatSnapshotOperation(operation: WorkspaceSnapshotOperation): string {
  if (operation === "read_directory") {
    return "reading directory";
  }
  if (operation === "read_file") {
    return "reading file";
  }
  return "checking file metadata";
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeSnapshotPath(root: string, absolutePath: string): string {
  return relative(root, absolutePath).split(sep).join("/");
}

function fileSnapshotsDiffer(
  before: WorkspaceFileSnapshot,
  after: WorkspaceFileSnapshot
): boolean {
  return (
    Object.keys(before.files).length !== Object.keys(after.files).length ||
    sortedSnapshotPaths(before, after).some(
      (path) => !sameSnapshotEntry(before.files[path], after.files[path])
    )
  );
}

function diffFileSnapshots(
  before: WorkspaceFileSnapshot,
  after: WorkspaceFileSnapshot
): WorkspaceDiff {
  const paths = sortedSnapshotPaths(before, after);
  const hunks: string[] = [];
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  for (const path of paths) {
    const beforeEntry = before.files[path];
    const afterEntry = after.files[path];
    if (sameSnapshotEntry(beforeEntry, afterEntry)) {
      continue;
    }

    filesChanged += 1;
    const beforeIsText = !beforeEntry || beforeEntry.kind === "text";
    const afterIsText = !afterEntry || afterEntry.kind === "text";
    if (!beforeIsText || !afterIsText) {
      hunks.push(renderBinarySnapshotDiff(path, beforeEntry, afterEntry));
      continue;
    }

    const beforeLines = beforeEntry ? snapshotLines(beforeEntry.content ?? "") : [];
    const afterLines = afterEntry ? snapshotLines(afterEntry.content ?? "") : [];
    deletions += beforeLines.length;
    insertions += afterLines.length;
    hunks.push(renderTextSnapshotDiff(path, beforeEntry, afterEntry));
  }

  const diff: WorkspaceDiff = {
    filesChanged,
    unifiedDiff: hunks.join("")
  };
  if (filesChanged > 0) {
    diff.insertions = insertions;
    diff.deletions = deletions;
  }
  return diff;
}

function sortedSnapshotPaths(
  before: WorkspaceFileSnapshot,
  after: WorkspaceFileSnapshot
): string[] {
  return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort();
}

function sameSnapshotEntry(
  before: WorkspaceFileSnapshotEntry | undefined,
  after: WorkspaceFileSnapshotEntry | undefined
): boolean {
  if (!before || !after) {
    return before === after;
  }
  if (before.kind !== after.kind || before.size !== after.size) {
    return false;
  }
  if (before.kind === "text") {
    return before.content === after.content;
  }
  return true;
}

function snapshotLines(content: string): string[] {
  if (!content) {
    return [];
  }
  return content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
}

function renderTextSnapshotDiff(
  path: string,
  beforeEntry: WorkspaceFileSnapshotEntry | undefined,
  afterEntry: WorkspaceFileSnapshotEntry | undefined
): string {
  const beforeLines = beforeEntry ? snapshotLines(beforeEntry.content ?? "") : [];
  const afterLines = afterEntry ? snapshotLines(afterEntry.content ?? "") : [];
  const oldPath = beforeEntry ? `a/${path}` : "/dev/null";
  const newPath = afterEntry ? `b/${path}` : "/dev/null";
  return [
    `diff --metaharness ${oldPath} ${newPath}`,
    beforeEntry ? undefined : "new file mode 100644",
    afterEntry ? undefined : "deleted file mode 100644",
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -${rangeHeader(beforeLines)} +${rangeHeader(afterLines)} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`)
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
    .concat("\n");
}

function renderBinarySnapshotDiff(
  path: string,
  beforeEntry: WorkspaceFileSnapshotEntry | undefined,
  afterEntry: WorkspaceFileSnapshotEntry | undefined
): string {
  const oldPath = beforeEntry ? `a/${path}` : "/dev/null";
  const newPath = afterEntry ? `b/${path}` : "/dev/null";
  return [
    `diff --metaharness ${oldPath} ${newPath}`,
    `Binary files ${oldPath} and ${newPath} differ`
  ]
    .join("\n")
    .concat("\n");
}

function rangeHeader(lines: string[]): string {
  return lines.length === 0 ? "0,0" : `1,${lines.length}`;
}
