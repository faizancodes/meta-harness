import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import {
  configJsonSchema,
  eventJsonSchema,
  sessionLedgerJsonSchema
} from "../packages/core/dist/index.js";
import { docsCapabilitiesCommand } from "../packages/cli/dist/index.js";
import { policyJsonSchema } from "../packages/policy/dist/index.js";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const providerCapabilitiesArtifact = {
  path: "docs/provider-capabilities.md",
  render: renderProviderCapabilities
};

export const schemaArtifacts = [
  {
    path: "schemas/metaharness.config.schema.json",
    render: () => renderJson(configJsonSchema(), "schemas/metaharness.config.schema.json")
  },
  {
    path: "schemas/metaharness.policy.schema.json",
    render: () => renderJson(policyJsonSchema(), "schemas/metaharness.policy.schema.json")
  },
  {
    path: "schemas/event.schema.json",
    render: () => renderJson(eventJsonSchema(), "schemas/event.schema.json")
  },
  {
    path: "schemas/session-ledger.schema.json",
    render: () =>
      renderJson(sessionLedgerJsonSchema(), "schemas/session-ledger.schema.json")
  }
];

export const generatedArtifacts = [providerCapabilitiesArtifact, ...schemaArtifacts];

export async function writeGeneratedArtifact(artifact) {
  const target = resolve(repoRoot, artifact.path);
  const rendered = await artifact.render();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, rendered, "utf8");
  console.log(`wrote ${artifact.path}`);
}

async function renderProviderCapabilities() {
  const io = memoryIO();
  await docsCapabilitiesCommand(
    {
      cwd: repoRoot
    },
    io
  );
  return prettier.format(io.stdoutText(), {
    ...((await prettier.resolveConfig(
      resolve(repoRoot, "docs/provider-capabilities.md")
    )) ?? {}),
    filepath: resolve(repoRoot, "docs/provider-capabilities.md")
  });
}

async function renderJson(schema, relativePath) {
  const target = resolve(repoRoot, relativePath);
  return prettier.format(JSON.stringify(schema), {
    ...((await prettier.resolveConfig(target)) ?? {}),
    filepath: target
  });
}

function memoryIO() {
  let stdout = "";
  let stderr = "";
  return {
    stderr: {
      write: (chunk) => {
        stderr += String(chunk);
        return true;
      }
    },
    stdout: {
      write: (chunk) => {
        stdout += String(chunk);
        return true;
      }
    },
    stderrText: () => stderr,
    stdoutText: () => stdout
  };
}
