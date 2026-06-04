import { createLedgerId } from "./ids.js";
import { redactValue, safeStringify } from "./redact.js";
import type { HarnessConfig } from "./types/config.js";
import type { PortableRunEvent } from "./types/events.js";
import type { SessionLedger } from "./types/ledger.js";
import type { RunInput } from "./types/run.js";
import type { RunResult } from "./types/result.js";
import type { VerificationResult } from "./verification.js";
import type {
  PreparedWorkspace,
  WorkspaceDiff,
  WorkspaceSnapshot
} from "./types/workspace.js";
import type { RunPaths } from "./run-store.js";

type LedgerTool = SessionLedger["tools"][number];
type LedgerCommand = SessionLedger["commands"][number];
type LedgerFileChange = SessionLedger["files"]["changed"][number];
type LedgerArtifact = SessionLedger["artifacts"][number];
type LedgerDiff = SessionLedger["diff"];
type LedgerPlan = SessionLedger["plans"][number];
type LedgerSummary = SessionLedger["summary"];
type LedgerTranscriptEntry = SessionLedger["transcript"][number];
type LedgerUsage = NonNullable<SessionLedger["usage"]>;
type LedgerVerification = SessionLedger["verification"][number];

export interface BuildSessionLedgerInput {
  adapterSnapshot?: Partial<SessionLedger> | undefined;
  config: HarnessConfig;
  events: PortableRunEvent[];
  input: RunInput;
  paths: RunPaths;
  result: RunResult;
  verification?: VerificationResult[];
  workspace?: {
    after: WorkspaceSnapshot;
    before: WorkspaceSnapshot;
    diff: WorkspaceDiff;
    prepared: PreparedWorkspace;
  };
}

export function buildSessionLedger(input: BuildSessionLedgerInput): SessionLedger {
  const { adapterSnapshot, config, events, paths, result, verification, workspace } =
    input;
  const createdAt = events[0]?.ts ?? new Date().toISOString();
  const updatedAt = events.at(-1)?.ts ?? createdAt;
  const counts = countEvents(events);
  const finalDiff = lastEvent(events, "diff.updated")?.unifiedDiff ?? result.diff;
  const lastUsage = lastEvent(events, "usage.updated")?.usage ?? result.usage;
  const changedFiles = buildChangedFileEntries(events, finalDiff);
  const artifacts = buildArtifactEntries(events, result.artifacts);

  const diff: LedgerDiff = {};
  if (result.patchPath) {
    diff.patchPath = result.patchPath;
  }
  if (finalDiff) {
    diff.unifiedDiff = finalDiff;
  }

  const summary: LedgerSummary = {
    facts: [],
    openQuestions: [],
    nextSteps:
      result.status === "success"
        ? []
        : ["Inspect events.ndjson, result.json, and any captured diff before resuming."]
  };
  if (result.finalMessage) {
    summary.finalMessage = result.finalMessage;
  }
  if (result.status === "failed" && result.finalMessage) {
    summary.failureReason = result.finalMessage;
  }

  const ledger: SessionLedger = {
    schemaVersion: "metaharness.session-ledger.v1",
    ledgerId: createLedgerId(result.runId),
    createdAt,
    updatedAt,
    task: {
      originalPrompt: input.input.task,
      mode: input.input.mode ?? "edit"
    },
    provider: {
      id: result.provider
    },
    workspace: {
      cwd: workspace?.prepared.cwd ?? config.workspace.cwd,
      dirtyBefore: workspace?.before.dirty ?? false,
      dirtyAfter: workspace?.after.dirty ?? false
    },
    events: {
      eventLogPath: paths.events,
      counts
    },
    transcript: buildTranscript(input.input.task, createdAt, events),
    plans: events
      .filter((event) => event.type === "plan.updated")
      .map((event) => ({
        ts: event.ts,
        steps: event.steps.map((step) => ({
          step: step.step,
          status: step.status
        }))
      })),
    tools: buildToolEntries(events),
    commands: events
      .filter((event) => event.type === "command.finished")
      .map((event) => {
        const command: LedgerCommand = {
          ts: event.ts,
          command: event.command
        };
        if (event.cwd) {
          command.cwd = event.cwd;
        }
        if (event.exitCode !== undefined) {
          command.exitCode = event.exitCode;
        }
        if (event.outputSummary) {
          command.outputSummary = event.outputSummary;
        }
        return command;
      }),
    files: {
      read: readFilesFromToolEvents(events),
      changed: changedFiles
    },
    verification: (verification ?? []).map((entry) => {
      const mapped: SessionLedger["verification"][number] = {
        command: entry.command
      };
      if (entry.exitCode !== undefined) {
        mapped.exitCode = entry.exitCode;
      }
      if (entry.outputPath) {
        mapped.outputPath = entry.outputPath;
      }
      if (entry.summary) {
        mapped.summary = entry.summary;
      }
      return mapped;
    }),
    artifacts,
    diff,
    summary
  };

  if (input.input.desiredOutput) {
    ledger.task.desiredOutput = input.input.desiredOutput;
  }
  if (workspace?.prepared.gitRoot) {
    ledger.workspace.repo = {};
    if (workspace.prepared.startingCommit) {
      ledger.workspace.repo.startingCommit = workspace.prepared.startingCommit;
    }
    if (workspace.after.commit) {
      ledger.workspace.repo.endingCommit = workspace.after.commit;
    }
    if (workspace.before.branch) {
      ledger.workspace.repo.baseRef = workspace.before.branch;
    }
    if (workspace.after.branch) {
      ledger.workspace.repo.headRef = workspace.after.branch;
      ledger.workspace.repo.branch = workspace.after.branch;
    } else if (workspace.prepared.branch) {
      ledger.workspace.repo.branch = workspace.prepared.branch;
    }
  }
  if (workspace?.diff.filesChanged) {
    ledger.diff.stats = {
      filesChanged: workspace.diff.filesChanged
    };
    if (workspace.diff.insertions !== undefined) {
      ledger.diff.stats.insertions = workspace.diff.insertions;
    }
    if (workspace.diff.deletions !== undefined) {
      ledger.diff.stats.deletions = workspace.diff.deletions;
    }
  }
  if (input.input.model) {
    ledger.provider.model = input.input.model;
  }
  if (input.input.runtime) {
    ledger.provider.runtime = input.input.runtime;
  } else {
    const configuredRuntime = config.providers?.[result.provider]?.runtime;
    if (configuredRuntime) {
      ledger.provider.runtime = configuredRuntime;
    }
  }
  if (result.nativeSessionId) {
    ledger.provider.nativeSessionId = result.nativeSessionId;
  }
  if (result.nativeRunId) {
    ledger.provider.nativeRunId = result.nativeRunId;
  }
  if (result.providerRunUrl) {
    ledger.provider.nativeUrl = result.providerRunUrl;
  }
  if (input.input.rawEvents ?? config.rawEvents ?? false) {
    ledger.events.rawEventLogPath = paths.rawEvents;
  }
  if (lastUsage) {
    const usage: LedgerUsage = {};
    if (lastUsage.inputTokens !== undefined) {
      usage.inputTokens = lastUsage.inputTokens;
    }
    if (lastUsage.outputTokens !== undefined) {
      usage.outputTokens = lastUsage.outputTokens;
    }
    if (lastUsage.cacheReadTokens !== undefined) {
      usage.cacheReadTokens = lastUsage.cacheReadTokens;
    }
    if (lastUsage.cacheWriteTokens !== undefined) {
      usage.cacheWriteTokens = lastUsage.cacheWriteTokens;
    }
    if (lastUsage.totalTokens !== undefined) {
      usage.totalTokens = lastUsage.totalTokens;
    }
    if (lastUsage.estimatedCostUsd !== undefined) {
      usage.estimatedCostUsd = lastUsage.estimatedCostUsd;
    }
    ledger.usage = usage;
  }
  const handoffFrom = handoffFromMetadata(input.input.metadata?.handoffFrom);
  if (handoffFrom) {
    ledger.handoffFrom = handoffFrom;
  }

  mergeAdapterSnapshot(ledger, adapterSnapshot);

  return redactValue(ledger, {
    enabled: config.storage?.redactSecrets !== false
  }) as SessionLedger;
}

function mergeAdapterSnapshot(
  ledger: SessionLedger,
  snapshot: Partial<SessionLedger> | undefined
): void {
  if (!snapshot) {
    return;
  }

  if (snapshot.summary) {
    mergeSummarySnapshot(ledger.summary, snapshot.summary);
  }
  appendUniqueBy(ledger.transcript, snapshot.transcript, ledgerEntryKey);
  appendUniqueBy(ledger.plans, snapshot.plans, ledgerEntryKey);
  appendUniqueBy(ledger.tools, snapshot.tools, ledgerEntryKey);
  appendUniqueBy(ledger.commands, snapshot.commands, ledgerEntryKey);
  appendUniqueBy(ledger.verification, snapshot.verification, ledgerEntryKey);
  appendUniqueBy(ledger.artifacts, snapshot.artifacts, artifactKey);

  if (snapshot.files) {
    appendUniqueStrings(ledger.files.read, snapshot.files.read);
    ledger.files.read.sort();
    mergeFileChanges(ledger.files.changed, snapshot.files.changed);
  }
  if (snapshot.usage) {
    mergeUsage(ledger, snapshot.usage);
  }
}

function mergeSummarySnapshot(summary: LedgerSummary, snapshot: LedgerSummary): void {
  if (!summary.finalMessage && snapshot.finalMessage) {
    summary.finalMessage = snapshot.finalMessage;
  }
  if (!summary.failureReason && snapshot.failureReason) {
    summary.failureReason = snapshot.failureReason;
  }
  appendUniqueStrings(summary.facts, snapshot.facts);
  appendUniqueStrings(summary.openQuestions, snapshot.openQuestions);
  appendUniqueStrings(summary.nextSteps, snapshot.nextSteps);
}

function mergeFileChanges(
  target: LedgerFileChange[],
  snapshotChanges: LedgerFileChange[]
): void {
  const byPath = new Map(target.map((file) => [file.path, file]));
  for (const snapshotFile of snapshotChanges) {
    const existing = byPath.get(snapshotFile.path);
    if (!existing) {
      const appended = { ...snapshotFile };
      target.push(appended);
      byPath.set(appended.path, appended);
      continue;
    }
    if (!existing.diff && snapshotFile.diff) {
      existing.diff = snapshotFile.diff;
    }
    if (existing.kind === "unknown" && snapshotFile.kind !== "unknown") {
      existing.kind = snapshotFile.kind;
    }
  }
}

function mergeUsage(ledger: SessionLedger, snapshotUsage: LedgerUsage): void {
  const usage: LedgerUsage = ledger.usage ?? {};
  if (usage.inputTokens === undefined && snapshotUsage.inputTokens !== undefined) {
    usage.inputTokens = snapshotUsage.inputTokens;
  }
  if (usage.outputTokens === undefined && snapshotUsage.outputTokens !== undefined) {
    usage.outputTokens = snapshotUsage.outputTokens;
  }
  if (
    usage.cacheReadTokens === undefined &&
    snapshotUsage.cacheReadTokens !== undefined
  ) {
    usage.cacheReadTokens = snapshotUsage.cacheReadTokens;
  }
  if (
    usage.cacheWriteTokens === undefined &&
    snapshotUsage.cacheWriteTokens !== undefined
  ) {
    usage.cacheWriteTokens = snapshotUsage.cacheWriteTokens;
  }
  if (usage.totalTokens === undefined && snapshotUsage.totalTokens !== undefined) {
    usage.totalTokens = snapshotUsage.totalTokens;
  }
  if (
    usage.estimatedCostUsd === undefined &&
    snapshotUsage.estimatedCostUsd !== undefined
  ) {
    usage.estimatedCostUsd = snapshotUsage.estimatedCostUsd;
  }
  ledger.usage = usage;
}

function appendUniqueStrings(target: string[], values: string[]): void {
  const seen = new Set(target);
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    target.push(value);
  }
}

function appendUniqueBy<T>(
  target: T[],
  values: T[] | undefined,
  keyFor: (value: T) => string
): void {
  if (!values) {
    return;
  }
  const seen = new Set(target.map(keyFor));
  for (const value of values) {
    const key = keyFor(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    target.push(value);
  }
}

function ledgerEntryKey(
  entry:
    | LedgerTranscriptEntry
    | LedgerPlan
    | LedgerTool
    | LedgerCommand
    | LedgerVerification
): string {
  return safeStringify(entry) ?? "";
}

function artifactKey(artifact: LedgerArtifact): string {
  return [
    artifact.kind,
    artifact.name ?? "",
    artifact.path ?? "",
    artifact.url ?? ""
  ].join("\0");
}

function handoffFromMetadata(value: unknown): SessionLedger["handoffFrom"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.ledgerId !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.runId !== "string"
  ) {
    return undefined;
  }
  if (!isProviderId(record.provider)) {
    return undefined;
  }
  return {
    ledgerId: record.ledgerId,
    provider: record.provider,
    runId: record.runId
  };
}

function isProviderId(value: string): value is SessionLedger["provider"]["id"] {
  return (
    value === "mock" || value === "claude" || value === "cursor" || value === "codex"
  );
}

export function renderHandoffMarkdown(ledger: SessionLedger): string {
  const markdown = `# metaharness handoff

## Original task
${ledger.task.originalPrompt}

## Previous provider
${ledger.provider.id}${ledger.provider.model ? ` / ${ledger.provider.model}` : ""}

## Current repo state
- Starting commit: ${ledger.workspace.repo?.startingCommit ?? "unknown"}
- Ending commit: ${ledger.workspace.repo?.endingCommit ?? "unknown"}
- Branch: ${ledger.workspace.repo?.branch ?? "unknown"}

## Summary
${ledger.summary.finalMessage ?? "No final message recorded."}

## Known facts
${renderList(ledger.summary.facts)}

## Latest plan
${renderLatestPlan(ledger)}

## Commands already run
${renderList(ledger.commands.map((command) => `${command.command} => ${command.exitCode ?? "unknown"}`))}

## Files changed
${renderList(ledger.files.changed.map((file) => `${file.path} (${file.kind})`))}

## Verification
${renderList(
  ledger.verification.map(
    (verification) =>
      `${verification.command} => ${verification.exitCode ?? "unknown"}: ${
        verification.summary ?? ""
      }`
  )
)}

## Current diff
A patch file is available at: ${ledger.diff.patchPath ?? "not captured"}

## Portability boundary
This handoff transfers explicit metaharness ledger context, artifacts, and diff only. It does not transfer hidden provider-native session state.

## Instructions for the next agent
Continue from the current working tree and diff. Do not redo completed investigation unless necessary.
First inspect the diff and verification output, then complete the original task.
Preserve existing changes unless they are incorrect.
Run the configured verification commands before finishing.
`;

  return redactValue(markdown) as string;
}

function countEvents(events: PortableRunEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

function lastEvent<TType extends PortableRunEvent["type"]>(
  events: PortableRunEvent[],
  type: TType
): Extract<PortableRunEvent, { type: TType }> | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === type) {
      return event as Extract<PortableRunEvent, { type: TType }>;
    }
  }
  return undefined;
}

function buildTranscript(
  originalPrompt: string,
  createdAt: string,
  events: PortableRunEvent[]
): LedgerTranscriptEntry[] {
  const transcript: LedgerTranscriptEntry[] = [
    {
      role: "user",
      text: originalPrompt,
      ts: createdAt
    }
  ];
  for (const event of events) {
    if (event.type === "assistant.message.completed") {
      transcript.push({
        providerEventRef: event.id,
        role: "assistant",
        text: event.text,
        ts: event.ts
      });
      continue;
    }
    if (event.type === "tool.finished") {
      const summary = summarize(event.output ?? event.error);
      const entry: LedgerTranscriptEntry = {
        providerEventRef: event.id,
        role: "tool",
        ts: event.ts
      };
      if (summary) {
        entry.summary = summary;
      }
      transcript.push(entry);
    }
  }
  return transcript;
}

function buildToolEntries(events: PortableRunEvent[]): LedgerTool[] {
  return events
    .filter((event) => event.type === "tool.started" || event.type === "tool.finished")
    .map((event) => {
      const tool: LedgerTool = {
        ts: event.ts,
        name: event.tool.name,
        kind: event.tool.kind
      };
      if (event.type === "tool.started") {
        const inputSummary = summarize(event.input);
        if (inputSummary) {
          tool.inputSummary = inputSummary;
        }
      } else {
        const outputSummary = summarize(event.output ?? event.error);
        if (outputSummary) {
          tool.outputSummary = outputSummary;
        }
      }
      return tool;
    });
}

function buildChangedFileEntries(
  events: PortableRunEvent[],
  diff: string | undefined
): LedgerFileChange[] {
  const byPath = new Map<string, LedgerFileChange>();
  for (const event of events) {
    if (event.type !== "file.change.finished") {
      continue;
    }
    const file: LedgerFileChange = {
      kind: event.changeKind,
      path: event.path
    };
    if (event.diff) {
      file.diff = event.diff;
    }
    byPath.set(file.path, file);
  }

  for (const parsed of parseChangedFilesFromDiff(diff)) {
    const existing = byPath.get(parsed.path);
    if (!existing) {
      byPath.set(parsed.path, parsed);
      continue;
    }
    if (!existing.diff && parsed.diff) {
      existing.diff = parsed.diff;
    }
    if (existing.kind === "unknown" && parsed.kind !== "unknown") {
      existing.kind = parsed.kind;
    }
  }

  return [...byPath.values()];
}

function buildArtifactEntries(
  events: PortableRunEvent[],
  resultArtifacts: RunResult["artifacts"]
): LedgerArtifact[] {
  const artifacts: LedgerArtifact[] = [];
  const seen = new Set<string>();
  const append = (artifact: LedgerArtifact) => {
    const key = [
      artifact.kind,
      artifact.name ?? "",
      artifact.path ?? "",
      artifact.url ?? ""
    ].join("\0");
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    artifacts.push(artifact);
  };

  for (const artifact of resultArtifacts) {
    append(toLedgerArtifact(artifact));
  }
  for (const event of events) {
    if (event.type === "artifact.created") {
      append(toLedgerArtifact(event.artifact));
    }
  }
  return artifacts;
}

function toLedgerArtifact(artifact: RunResult["artifacts"][number]): LedgerArtifact {
  const ledgerArtifact: LedgerArtifact = {
    kind: artifact.kind === "screenshot" ? "file" : artifact.kind
  };
  if (artifact.name) {
    ledgerArtifact.name = artifact.name;
  }
  if (artifact.path) {
    ledgerArtifact.path = artifact.path;
  }
  if (artifact.url) {
    ledgerArtifact.url = artifact.url;
  }
  return ledgerArtifact;
}

function parseChangedFilesFromDiff(diff: string | undefined): LedgerFileChange[] {
  if (!diff) {
    return [];
  }
  return splitDiffBlocks(diff)
    .map(parseChangedFileBlock)
    .filter((file): file is LedgerFileChange => Boolean(file));
}

function splitDiffBlocks(diff: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of diff.split("\n")) {
    if (
      (line.startsWith("diff --git ") || line.startsWith("diff --metaharness ")) &&
      current.length > 0
    ) {
      blocks.push(current.join("\n"));
      current = [line];
      continue;
    }
    if (current.length > 0 || line.startsWith("diff --")) {
      current.push(line);
    }
  }
  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }
  return blocks;
}

function parseChangedFileBlock(block: string): LedgerFileChange | undefined {
  const lines = block.split("\n");
  const oldPath = normalizeDiffPath(headerPath(lines, "--- "));
  const newPath = normalizeDiffPath(headerPath(lines, "+++ "));
  const renameFrom = renamePath(lines, "rename from ");
  const renameTo = renamePath(lines, "rename to ");
  const firstLine = lines[0] ?? "";

  const kind = diffChangeKind(lines, oldPath, newPath, renameFrom, renameTo);
  const path =
    newPath ??
    renameTo ??
    oldPath ??
    renameFrom ??
    normalizeDiffPath(pathFromGitDiffLine(firstLine, "new"));
  if (!path) {
    return undefined;
  }
  return {
    diff: block.endsWith("\n") ? block : `${block}\n`,
    kind,
    path
  };
}

function diffChangeKind(
  lines: string[],
  oldPath: string | undefined,
  newPath: string | undefined,
  renameFrom: string | undefined,
  renameTo: string | undefined
): LedgerFileChange["kind"] {
  if (renameFrom || renameTo || lines.some((line) => line.startsWith("rename "))) {
    return "rename";
  }
  if (!oldPath && newPath) {
    return "create";
  }
  if (oldPath && !newPath) {
    return "delete";
  }
  if (lines.some((line) => line.startsWith("new file mode "))) {
    return "create";
  }
  if (lines.some((line) => line.startsWith("deleted file mode "))) {
    return "delete";
  }
  if (oldPath || newPath) {
    return "modify";
  }
  return "unknown";
}

function headerPath(lines: string[], prefix: "--- " | "+++ "): string | undefined {
  return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
}

function renamePath(
  lines: string[],
  prefix: "rename from " | "rename to "
): string | undefined {
  const value = lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
  return normalizeDiffPath(value);
}

function normalizeDiffPath(path: string | undefined): string | undefined {
  if (!path || path === "/dev/null") {
    return undefined;
  }
  const unquoted = unquoteGitPath(path);
  return unquoted.startsWith("a/") || unquoted.startsWith("b/")
    ? unquoted.slice(2)
    : unquoted;
}

function pathFromGitDiffLine(line: string, side: "old" | "new"): string | undefined {
  if (!line.startsWith("diff --git ")) {
    return undefined;
  }
  const remainder = line.slice("diff --git ".length);
  const match = /(?:^|\s)(a\/.+?)\s+(b\/.+)$/.exec(remainder);
  if (!match) {
    return undefined;
  }
  return side === "old" ? match[1] : match[2];
}

function unquoteGitPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }
  try {
    return JSON.parse(trimmed) as string;
  } catch {
    return trimmed.slice(1, -1);
  }
}

function readFilesFromToolEvents(events: PortableRunEvent[]): string[] {
  const paths = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool.started" || !isReadLikeTool(event.tool.name)) {
      continue;
    }
    for (const path of pathsFromToolInput(event.input)) {
      paths.add(path);
    }
  }
  return [...paths].sort();
}

function isReadLikeTool(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return [
    "cat",
    "glob",
    "grep",
    "open",
    "read",
    "readfile",
    "readfiles",
    "view"
  ].includes(normalized);
}

function pathsFromToolInput(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }
  const record = input as Record<string, unknown>;
  const candidates = [
    record.path,
    record.file,
    record.filePath,
    record.file_path,
    record.relativePath,
    record.relative_path
  ];
  const paths: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && isLedgerPathCandidate(candidate)) {
      paths.push(candidate);
    }
  }
  return paths;
}

function isLedgerPathCandidate(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    !trimmed.includes("\n") &&
    !trimmed.startsWith("-") &&
    !/^https?:\/\//i.test(trimmed)
  );
}

function renderLatestPlan(ledger: SessionLedger): string {
  const latest = ledger.plans.at(-1);
  if (!latest) {
    return "No plan events recorded.";
  }
  return renderList(latest.steps.map((step) => `${step.status}: ${step.step}`));
}

function renderList(values: string[]): string {
  if (values.length === 0) {
    return "- none";
  }
  return values.map((value) => `- ${value}`).join("\n");
}

function summarize(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.slice(0, 500);
  }
  return safeStringify(value)?.slice(0, 500);
}
