import type { PortableRunEvent } from "@metaharness/core";

export function renderEvent(event: PortableRunEvent): string {
  switch (event.type) {
    case "run.started":
      return `[${event.seq}] run started (${event.input.mode})`;
    case "assistant.message.delta":
      return `[${event.seq}] assistant: ${event.text}`;
    case "assistant.message.completed":
      return `[${event.seq}] assistant complete: ${event.text}`;
    case "plan.updated":
      return `[${event.seq}] plan: ${event.steps.map((step) => `${step.status}:${step.step}`).join(", ")}`;
    case "command.started":
      return `[${event.seq}] command started: ${event.command}`;
    case "command.finished":
      return `[${event.seq}] command finished: ${event.command} => ${event.exitCode ?? "unknown"}`;
    case "file.change.finished":
      return `[${event.seq}] file ${event.changeKind}: ${event.path}`;
    case "diff.updated":
      return `[${event.seq}] diff updated (${event.unifiedDiff.length} bytes)`;
    case "usage.updated":
      return `[${event.seq}] usage: ${event.usage.totalTokens ?? "unknown"} tokens`;
    case "run.completed":
      return `[${event.seq}] run completed: ${event.status}`;
    case "error":
      return `[${event.seq}] error: ${event.error.message}`;
    default:
      return `[${event.seq}] ${event.type}`;
  }
}
