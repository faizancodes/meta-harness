# @metaharness/policy

Policy parsing, validation, provider warning, provider-native hint compilation,
command guard, and redaction helpers for metaharness.

## Install

```bash
pnpm add @metaharness/policy
```

## Use

```ts
import {
  checkCommandPolicy,
  compileProviderPolicy,
  parsePolicyYaml
} from "@metaharness/policy";

const parsed = parsePolicyYaml(`
version: 1
filesystem:
  mode: workspace-write
commands:
  default: deny
  allow:
    - "pnpm test"
`);

if (!parsed.policy) {
  throw new Error(parsed.diagnostics.errors[0]?.message ?? "Invalid policy");
}

const compiled = compileProviderPolicy("codex", parsed.policy);
const command = checkCommandPolicy("pnpm test", parsed.policy.commands);
console.log(compiled.provider, command.decision);
```

## Notes

- Requires Node.js 22 or newer.
- Policy is defense in depth. It compiles provider-native hints plus
  harness-observable guards; it is not a complete sandbox guarantee.
- Use argv arrays and `execFile` for harness-owned command execution.
- Keep policy diagnostics and redaction paths free of secret values.
- Policy diagnostic codes are listed in `docs/error-codes.md` in the
  metaharness repository.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
