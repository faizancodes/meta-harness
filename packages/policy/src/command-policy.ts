import type { CommandPolicy } from "./schema.js";

export type CommandPolicyDecision = "allow" | "deny" | "approval_required";

export interface CommandPolicyResult {
  decision: CommandPolicyDecision;
  matchedRule?: string;
  reason: string;
}

export function checkCommandPolicy(
  command: string,
  policy: CommandPolicy
): CommandPolicyResult {
  const parsed = parseCommand(command);
  if (!parsed.ok) {
    return {
      decision: "deny",
      reason: parsed.reason
    };
  }

  const denied = findMatchingRule(parsed.argv, policy.deny);
  if (denied) {
    return {
      decision: "deny",
      matchedRule: denied,
      reason: `Command matched deny rule "${denied}".`
    };
  }

  const allowed = findMatchingRule(parsed.argv, policy.allow);
  if (allowed) {
    return {
      decision: "allow",
      matchedRule: allowed,
      reason: `Command matched allow rule "${allowed}".`
    };
  }

  if (policy.default === "allow") {
    return {
      decision: "allow",
      reason: "No deny rule matched and commands.default is allow."
    };
  }

  return {
    decision: "deny",
    reason: "No allow rule matched and commands.default is deny."
  };
}

export function parseCommand(command: string):
  | {
      ok: true;
      argv: string[];
    }
  | {
      ok: false;
      reason: string;
    } {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      ok: false,
      reason: "Command is empty."
    };
  }
  if (containsShellOperator(trimmed)) {
    return {
      ok: false,
      reason: "Command contains shell operators and requires explicit provider approval."
    };
  }

  const argv = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (const char of trimmed) {
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
      reason: "Command contains an unterminated quote."
    };
  }
  if (current) {
    argv.push(current);
  }
  if (argv.length === 0) {
    return {
      ok: false,
      reason: "Command is empty."
    };
  }

  return {
    argv,
    ok: true
  };
}

export function findMatchingRule(
  argv: string[],
  rules: readonly string[]
): string | undefined {
  for (const rule of rules) {
    const parsedRule = parseRule(rule);
    if (!parsedRule.ok) {
      continue;
    }
    if (ruleMatches(argv, parsedRule.argv)) {
      return rule;
    }
  }
  return undefined;
}

function parseRule(rule: string):
  | {
      ok: true;
      argv: string[];
    }
  | {
      ok: false;
    } {
  const parsed = parseCommandAllowingTrailingGlob(rule);
  if (!parsed.ok) {
    return {
      ok: false
    };
  }
  return parsed;
}

function parseCommandAllowingTrailingGlob(command: string):
  | {
      ok: true;
      argv: string[];
    }
  | {
      ok: false;
    } {
  if (containsShellOperator(command)) {
    const argv = command.trim().split(/\s+/);
    if (argv.every((part) => part === "*" || !containsShellOperator(part))) {
      return {
        argv,
        ok: true
      };
    }
    return {
      ok: false
    };
  }
  const parsed = parseCommand(command);
  if (!parsed.ok) {
    return {
      ok: false
    };
  }
  return parsed;
}

function ruleMatches(argv: string[], ruleArgv: string[]): boolean {
  if (ruleArgv.length === 0) {
    return false;
  }
  const trailingGlob = ruleArgv.at(-1) === "*";
  const comparableRule = trailingGlob ? ruleArgv.slice(0, -1) : ruleArgv;
  if (trailingGlob && argv.length < comparableRule.length) {
    return false;
  }
  if (!trailingGlob && argv.length !== comparableRule.length) {
    return false;
  }
  for (let index = 0; index < comparableRule.length; index += 1) {
    const expected = comparableRule[index];
    const actual = argv[index];
    if (!expected || !actual) {
      return false;
    }
    if (expected === "*") {
      continue;
    }
    if (expected.includes("*")) {
      if (!globTokenMatches(actual, expected)) {
        return false;
      }
      continue;
    }
    if (expected !== actual) {
      return false;
    }
  }
  return true;
}

function globTokenMatches(value: string, pattern: string): boolean {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function containsShellOperator(value: string): boolean {
  return /(?:\|\||&&|[|;&<>`$()])/.test(value);
}
