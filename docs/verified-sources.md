# Verified Sources

Checked on 2026-06-02.

## Provider SDKs

- Claude Agent SDK overview: <https://docs.claude.com/en/api/agent-sdk/overview>
  verifies the `@anthropic-ai/claude-agent-sdk` package, API-key auth guidance,
  built-in tools, hooks, subagents, MCP, permissions, sessions, and the warning
  against third-party claude.ai login or rate-limit offerings without approval.
- Claude Agent SDK rename/background:
  <https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk/>
  confirms the Claude Code SDK rename to Claude Agent SDK.
- Cursor TypeScript SDK docs: <https://cursor.com/docs/sdk/typescript>
  document the TypeScript SDK surface.
- Cursor public beta announcement:
  <https://forum.cursor.com/t/cursor-sdk-in-public-beta/159285> verifies
  `@cursor/sdk`, `Agent.create`, local `cwd`, `agent.send`, `run.stream`, local
  and cloud runtimes, MCP servers, skills, hooks, and subagents.
- Codex SDK docs: <https://developers.openai.com/codex/sdk> verify
  `@openai/codex-sdk`, `Codex`, `startThread()`, `thread.run()`,
  `resumeThread()`, server-side Node usage, and sandbox presets.
- Codex app-server docs: <https://developers.openai.com/codex/app-server>
  verify JSON-RPC-like app-server integration, notifications for plan, diff,
  usage, command execution, file changes, MCP, web search, approvals, and item
  lifecycle events.

## Protocols

- MCP base protocol 2025-06-18:
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/index>
  verifies JSON-RPC 2.0 messages and the protocol split between base protocol,
  lifecycle, authorization, resources, prompts, tools, roots, sampling, and
  utilities.
- MCP lifecycle 2025-06-18:
  <https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle>
  verifies initialization, capability negotiation, operation, shutdown, timeouts,
  and cancellation guidance.

## Tooling And CI

- GitHub Actions Toolkit Context7 `/actions/toolkit` check verified
  `@actions/core` and `@actions/github` usage for JavaScript actions, inputs,
  outputs, and `setSecret` masking.
- GitHub workflow commands:
  <https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands>
  verify `add-mask`/secret masking behavior and workflow command files.
- GitHub script injection docs:
  <https://docs.github.com/en/actions/concepts/security/script-injections>
  verify untrusted context risks for workflow and action inputs.
- OpenTelemetry JS Context7 `/open-telemetry/opentelemetry-js` check verified
  that the API is safe/no-op until an SDK/exporter is configured and that spans
  can carry attributes.
- tsup Context7 `/egoist/tsup` check verified ESM builds, declaration generation,
  and package/peer dependency externalization behavior.
