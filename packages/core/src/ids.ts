import { createHash, randomUUID } from "node:crypto";
import type { ProviderId } from "./types/adapter.js";

export function createRunId(provider: ProviderId): string {
  return `${provider}-run-${randomUUID()}`;
}

export function createSessionId(provider: ProviderId): string {
  return `${provider}-session-${randomUUID()}`;
}

export function createEventId(runId: string, seq: number): string {
  return `${runId}-event-${String(seq).padStart(6, "0")}`;
}

export function createLedgerId(runId: string): string {
  return `ledger-${runId}`;
}

export function createCompareId(): string {
  return `compare-${randomUUID()}`;
}

export function hashTask(task: string): string {
  return createHash("sha256").update(task).digest("hex");
}
