import { createCliAdapters } from "../harness.js";
import { resolveWorkspaceCwd } from "../workspace.js";
import type { CliIO, GlobalOptions } from "../types.js";
import type { CapabilityFlag, ProviderCapabilities } from "@metaharness/core";

const providerOrder = ["mock", "claude", "cursor", "codex"];

export interface DocsCapabilitiesOptions extends GlobalOptions {
  json?: boolean;
}

export async function docsCapabilitiesCommand(
  options: DocsCapabilitiesOptions,
  io: CliIO
): Promise<ProviderCapabilities[]> {
  const cwd = await resolveWorkspaceCwd(options.cwd);
  const capabilities = await Promise.all(
    createCliAdapters().map((adapter) =>
      adapter.capabilities({
        cwd
      })
    )
  );
  capabilities.sort(
    (left, right) =>
      providerOrder.indexOf(left.provider) - providerOrder.indexOf(right.provider)
  );

  if (options.json) {
    io.stdout.write(`${JSON.stringify(capabilities, null, 2)}\n`);
  } else {
    io.stdout.write(renderProviderCapabilitiesMarkdown(capabilities));
  }
  return capabilities;
}

export function renderProviderCapabilitiesMarkdown(
  capabilities: ProviderCapabilities[]
): string {
  const providers = capabilities.map((capability) => capability.provider);
  const rows = capabilityRows(capabilities);
  const lines = [
    "# Provider Capabilities",
    "",
    "Generated from `ProviderCapabilities` returned by the installed adapters.",
    "Application code should branch on capability flags, not provider strings.",
    "",
    "```ts",
    'const provider = "cursor";',
    "const caps = await harness.agent(provider).capabilities();",
    "if (caps.workspace.openPullRequest.supported) {",
    "  // Enable PR controls.",
    "}",
    "```",
    "",
    ["Capability", ...providers].join(" | "),
    ["---", ...providers.map(() => "---")].join(" | ")
  ];

  for (const row of rows) {
    lines.push([row.label, ...row.values].join(" | "));
  }

  lines.push("", "## Known Limitations", "");
  for (const capability of capabilities) {
    lines.push(`### ${capability.provider}`, "");
    if (capability.nativeVersion) {
      lines.push(`Native package: \`${capability.nativeVersion}\``, "");
    }
    if (capability.knownLimitations.length === 0) {
      lines.push("- none");
    } else {
      for (const limitation of capability.knownLimitations) {
        lines.push(`- ${limitation}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function capabilityRows(capabilities: ProviderCapabilities[]): Array<{
  label: string;
  values: string[];
}> {
  return [
    row("runtime.local", capabilities, (caps) => caps.runtime.local),
    row("runtime.cloud", capabilities, (caps) => caps.runtime.cloud),
    row("runtime.selfHosted", capabilities, (caps) => caps.runtime.selfHosted),
    row("lifecycle.start", capabilities, (caps) => caps.lifecycle.start),
    row("lifecycle.stream", capabilities, (caps) => caps.lifecycle.stream),
    row("lifecycle.wait", capabilities, (caps) => caps.lifecycle.wait),
    row("lifecycle.cancel", capabilities, (caps) => caps.lifecycle.cancel),
    row("lifecycle.resume", capabilities, (caps) => caps.lifecycle.resume),
    row("lifecycle.fork", capabilities, (caps) => caps.lifecycle.fork),
    row("workspace.readFiles", capabilities, (caps) => caps.workspace.readFiles),
    row("workspace.writeFiles", capabilities, (caps) => caps.workspace.writeFiles),
    row("workspace.runCommands", capabilities, (caps) => caps.workspace.runCommands),
    row("workspace.gitDiff", capabilities, (caps) => caps.workspace.gitDiff),
    row("workspace.gitBranch", capabilities, (caps) => caps.workspace.gitBranch),
    row(
      "workspace.openPullRequest",
      capabilities,
      (caps) => caps.workspace.openPullRequest
    ),
    row("workspace.artifacts", capabilities, (caps) => caps.workspace.artifacts),
    row("tools.mcp", capabilities, (caps) => caps.tools.mcp),
    row("tools.skills", capabilities, (caps) => caps.tools.skills),
    row("tools.subagents", capabilities, (caps) => caps.tools.subagents),
    row("tools.hooks", capabilities, (caps) => caps.tools.hooks),
    row("tools.webSearch", capabilities, (caps) => caps.tools.webSearch),
    row(
      "policy.filesystemSandbox",
      capabilities,
      (caps) => caps.policy.filesystemSandbox
    ),
    row("policy.commandAllowDeny", capabilities, (caps) => caps.policy.commandAllowDeny),
    row("policy.networkControl", capabilities, (caps) => caps.policy.networkControl),
    row("policy.humanApprovals", capabilities, (caps) => caps.policy.humanApprovals),
    row(
      "policy.providerNativePermissions",
      capabilities,
      (caps) => caps.policy.providerNativePermissions
    ),
    row(
      "observability.tokenUsage",
      capabilities,
      (caps) => caps.observability.tokenUsage
    ),
    row("observability.cost", capabilities, (caps) => caps.observability.cost),
    row(
      "observability.planEvents",
      capabilities,
      (caps) => caps.observability.planEvents
    ),
    row(
      "observability.diffEvents",
      capabilities,
      (caps) => caps.observability.diffEvents
    ),
    row(
      "observability.commandEvents",
      capabilities,
      (caps) => caps.observability.commandEvents
    ),
    row(
      "observability.fileChangeEvents",
      capabilities,
      (caps) => caps.observability.fileChangeEvents
    ),
    row(
      "observability.toolCallEvents",
      capabilities,
      (caps) => caps.observability.toolCallEvents
    ),
    row(
      "observability.rawEventAccess",
      capabilities,
      (caps) => caps.observability.rawEventAccess
    )
  ];
}

function row(
  label: string,
  capabilities: ProviderCapabilities[],
  select: (capabilities: ProviderCapabilities) => CapabilityFlag
): {
  label: string;
  values: string[];
} {
  return {
    label,
    values: capabilities.map((caps) => formatFlag(select(caps)))
  };
}

function formatFlag(flag: CapabilityFlag): string {
  const support = flag.supported ? "yes" : "no";
  const suffix = flag.notes ? `; ${escapeTable(flag.notes)}` : "";
  return `${support} (${flag.stability})${suffix}`;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
