export interface WorkspaceConfig {
  cwd: string;
  git?: {
    requireClean?: boolean;
    createWorktree?: boolean;
    worktreeRoot?: string;
    branchPrefix?: string;
    baseRef?: string;
    commitChanges?: boolean;
  };
}

export interface PreparedWorkspace {
  cwd: string;
  fileSnapshot?: WorkspaceFileSnapshot;
  gitRoot?: string;
  startingCommit?: string;
  branch?: string;
  cleanup?: () => Promise<void>;
}

export interface WorkspaceSnapshot {
  dirty: boolean;
  commit?: string;
  branch?: string;
}

export interface WorkspaceDiff {
  unifiedDiff: string;
  filesChanged: number;
  insertions?: number;
  deletions?: number;
}

export interface WorkspaceFileSnapshot {
  files: Record<string, WorkspaceFileSnapshotEntry>;
  root: string;
}

export interface WorkspaceFileSnapshotEntry {
  content?: string;
  kind: "binary" | "text";
  size: number;
}
