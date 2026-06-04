import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const source = await readFile(resolve(repoRoot, "docs/verified-sources.md"), "utf8");
const normalizedSource = source.replace(/\s+/g, " ");
const failures = [];

const checkedDate = source.match(/^Checked on (\d{4}-\d{2}-\d{2})\.$/m)?.[1];
if (!checkedDate) {
  failures.push('docs/verified-sources.md should include "Checked on YYYY-MM-DD.".');
} else if (Number.isNaN(Date.parse(`${checkedDate}T00:00:00Z`))) {
  failures.push(
    `docs/verified-sources.md has an invalid checked date ${JSON.stringify(checkedDate)}.`
  );
}

for (const heading of ["Provider SDKs", "Protocols", "Tooling And CI"]) {
  expectSnippet(`## ${heading}`);
}

for (const snippet of [
  "@anthropic-ai/claude-agent-sdk",
  "https://docs.claude.com/en/api/agent-sdk/overview",
  "https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk/",
  "@cursor/sdk",
  "https://cursor.com/docs/sdk/typescript",
  "https://forum.cursor.com/t/cursor-sdk-in-public-beta/159285",
  "@openai/codex-sdk",
  "https://developers.openai.com/codex/sdk",
  "https://developers.openai.com/codex/app-server",
  "https://modelcontextprotocol.io/specification/2025-06-18/basic/index",
  "https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle",
  "Context7 `/actions/toolkit`",
  "https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands",
  "https://docs.github.com/en/actions/concepts/security/script-injections",
  "Context7 `/open-telemetry/opentelemetry-js`",
  "Context7 `/egoist/tsup`"
]) {
  expectSnippet(snippet);
}

if (/\bTODO\b|placeholder/i.test(source)) {
  failures.push("docs/verified-sources.md should not contain TODO or placeholder text.");
}

if (failures.length > 0) {
  throw new Error(
    `Verified source documentation check failed:\n- ${failures.join("\n- ")}`
  );
}

console.log(
  "Verified source documentation covers required provider, protocol, and tooling sources."
);

function expectSnippet(snippet) {
  if (normalizedSource.includes(snippet.replace(/\s+/g, " "))) {
    return;
  }
  failures.push(`docs/verified-sources.md should include ${JSON.stringify(snippet)}.`);
}
