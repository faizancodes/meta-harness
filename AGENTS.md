# AGENTS.md

Instructions for AI coding agents working in this repository.

## Repository Model

metaharness is a TypeScript-first SDK and CLI for running Claude, Cursor, Codex,
and deterministic mock coding agents through one production harness. Preserve
provider differences instead of hiding them.

Core rules:

- Branch public examples and application logic on `ProviderCapabilities`, not
  provider strings, whenever a capability flag exists.
- Use the official provider SDK packages only:
  `@anthropic-ai/claude-agent-sdk`, `@cursor/sdk`, and `@openai/codex-sdk`.
- Keep provider SDKs as optional peer dependencies and load them dynamically in
  adapters.
- Pass MCP configuration through to providers. Do not build a metaharness-native
  MCP replacement.
- Do not claim provider-native session state is portable. Handoff uses
  `SessionLedger`, `handoff.md`, `diff.patch`, and verification output.
- Keep raw provider events disabled unless debugging adapter behavior.
- Treat `.harness/` artifacts as sensitive because they can contain prompts,
  transcripts, diffs, command summaries, and provider metadata.

## Current Docs

Before changing behavior, read the relevant local docs:

- `README.md`
- `docs/sdk.md`
- `docs/cli.md`
- `docs/architecture.md`
- `docs/adapters.md`
- `docs/provider-capabilities.md`
- `docs/policy.md`
- `docs/conformance.md`
- `docs/development.md`

For CLI or run-artifact changes, remember that repo-local `pnpm hk` runs the
built CLI at `packages/cli/dist/index.js`, so run `pnpm build` before CLI smoke
commands.

Use `pnpm --silent commands -- --json` when an automated session needs the
repo's curated command map without scraping terminal text.

## External Library Docs

Use Context7 MCP for current documentation whenever a task asks about a library,
framework, SDK, API, CLI tool, or cloud service. Start with
`resolve-library-id`, then query the selected library ID with the user's full
question. Do not use Context7 for ordinary repo refactoring, business-logic
debugging, code review, or general programming concepts.

For OpenAI or Codex product/API questions, use the OpenAI docs skill or official
OpenAI sources.

## Validation

Use focused checks while iterating, then run the broader gate before handoff.

```bash
pnpm setup:check
pnpm docs:check
pnpm check
```

For release, package, example, or broad handoff work, run:

```bash
pnpm ci:check
```

Live provider conformance is opt-in. Do not run live provider tests unless the
matching API keys and gate variables are intentionally set.
