import type { PortableRunEvent } from "./types/events.js";

const sensitiveKeyPattern = /(?:api[_-]?key|authorization|credential|password|secret)/i;

const defaultSecretPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{20,}/g
] as const;

export interface RedactionOptions {
  enabled?: boolean;
  env?: NodeJS.ProcessEnv;
  patterns?: RegExp[];
}

export function redactEvent(
  event: PortableRunEvent,
  options: RedactionOptions = {}
): PortableRunEvent {
  return redactValue(event, options) as PortableRunEvent;
}

export function redactValue(value: unknown, options: RedactionOptions = {}): unknown {
  if (options.enabled === false) {
    return value;
  }
  return redactRecursive(value, options, new WeakMap<object, unknown>());
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== "object" || item === null) {
      return item;
    }
    if (seen.has(item)) {
      return "[Circular]";
    }
    seen.add(item);
    return item;
  });
}

function redactRecursive(
  value: unknown,
  options: RedactionOptions,
  seen: WeakMap<object, unknown>
): unknown {
  if (typeof value === "string") {
    return redactString(value, options);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const cached = seen.get(value);
  if (cached) {
    return cached;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) {
      out.push(redactRecursive(item, options, seen));
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, item] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      out[key] = "[REDACTED]";
      continue;
    }
    out[key] = redactRecursive(item, options, seen);
  }
  return out;
}

function redactString(value: string, options: RedactionOptions): string {
  let redacted = value;
  for (const secret of collectEnvSecrets(options.env ?? process.env)) {
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  for (const pattern of [...defaultSecretPatterns, ...(options.patterns ?? [])]) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

function isSensitiveKey(key: string): boolean {
  if (sensitiveKeyPattern.test(key)) {
    return true;
  }
  const parts = splitKeyParts(key);
  if (!parts.includes("token") && !parts.includes("tokens")) {
    return false;
  }
  return !isUsageTokenMetric(parts);
}

function collectEnvSecrets(env: NodeJS.ProcessEnv): string[] {
  const secrets = new Set<string>();
  for (const [key, value] of Object.entries(env)) {
    if (!value || value.length < 8) {
      continue;
    }
    if (isSensitiveKey(key)) {
      secrets.add(value);
    }
  }
  return [...secrets];
}

function splitKeyParts(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isUsageTokenMetric(parts: string[]): boolean {
  const normalized = parts.join(".");
  return (
    normalized === "token.usage" ||
    normalized === "input.tokens" ||
    normalized === "output.tokens" ||
    normalized === "total.tokens" ||
    normalized === "cache.read.tokens" ||
    normalized === "cache.write.tokens" ||
    normalized === "cached.input.tokens" ||
    normalized === "cache.creation.input.tokens" ||
    normalized === "cache.read.input.tokens" ||
    normalized === "reasoning.output.tokens"
  );
}
