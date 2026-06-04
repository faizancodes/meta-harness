import { builtinModules } from "node:module";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const packagesDir = join(repoRoot, "packages");
const execFile = promisify(execFileCallback);
const builtinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((specifier) => `node:${specifier}`)
]);
const commonPackageKeywords = ["metaharness", "coding-agents", "ai-agents", "automation"];
const packageSpecificKeywords: Record<string, string[]> = {
  "@metaharness/adapter-mock": ["testing", "mock"],
  "@metaharness/claude": ["claude", "adapter"],
  "@metaharness/cli": ["cli", "workflow"],
  "@metaharness/codex": ["codex", "adapter"],
  "@metaharness/core": ["sdk", "orchestration"],
  "@metaharness/cursor": ["cursor", "adapter"],
  "@metaharness/github-action": ["github-actions", "ci"],
  "@metaharness/policy": ["policy", "security"],
  "@metaharness/telemetry": ["telemetry", "opentelemetry"]
};

describe("package manifests", () => {
  it("include consumer-friendly package metadata", async () => {
    const failures: string[] = [];

    for (const packageDir of await packageDirectories()) {
      const manifest = await readPackageManifest(packageDir);
      const expectedNode =
        manifest.name === "@metaharness/github-action" ? ">=20.0.0" : ">=22.0.0";

      if (!manifest.description?.trim()) {
        failures.push(`${manifest.name} is missing a package description`);
      }
      for (const keyword of expectedPackageKeywords(manifest.name)) {
        if (!manifest.keywords?.includes(keyword)) {
          failures.push(`${manifest.name} keywords must include ${keyword}`);
        }
      }
      if (manifest.types !== "./dist/index.d.ts") {
        failures.push(`${manifest.name} must declare types as ./dist/index.d.ts`);
      }
      if (manifest.exports?.["."]?.types !== manifest.types) {
        failures.push(`${manifest.name} root export types must match package types`);
      }
      if (manifest.exports?.["."]?.import !== "./dist/index.js") {
        failures.push(`${manifest.name} root export import must be ./dist/index.js`);
      }
      if (!manifest.files?.includes("dist")) {
        failures.push(`${manifest.name} files must include dist`);
      }
      if (!manifest.files?.includes("README.md")) {
        failures.push(`${manifest.name} files must include README.md`);
      }
      if (manifest.engines?.node !== expectedNode) {
        failures.push(`${manifest.name} engines.node must be ${expectedNode}`);
      }
      if (manifest.publishConfig?.access !== "public") {
        failures.push(`${manifest.name} publishConfig.access must be public`);
      }

      const readme = await readPackageReadme(packageDir);
      if (!readme.trim()) {
        failures.push(`${manifest.name} is missing README.md`);
      } else {
        if (!readme.startsWith(`# ${manifest.name}\n`)) {
          failures.push(`${manifest.name} README.md must start with the package name`);
        }
        if (!readme.includes("## Install")) {
          failures.push(`${manifest.name} README.md must include installation guidance`);
        }
        if (!readme.includes("## Notes")) {
          failures.push(`${manifest.name} README.md must include package notes`);
        }
        if (!readme.includes("SUPPORT.md")) {
          failures.push(`${manifest.name} README.md must mention SUPPORT.md`);
        }
        if (!readme.includes("sensitive artifact guidance")) {
          failures.push(
            `${manifest.name} README.md must mention sensitive artifact guidance`
          );
        }
        const runtimeNote = runtimeReadmeNote(manifest.engines?.node);
        if (!readme.includes(runtimeNote)) {
          failures.push(`${manifest.name} README.md must mention ${runtimeNote}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps provider SDK peers optional and out of dependencies", async () => {
    const failures: string[] = [];
    const providerPeers = new Set([
      "@anthropic-ai/claude-agent-sdk",
      "@cursor/sdk",
      "@openai/codex-sdk"
    ]);

    for (const packageDir of await packageDirectories()) {
      const manifest = await readPackageManifest(packageDir);
      for (const providerPeer of providerPeers) {
        if (manifest.dependencies?.[providerPeer]) {
          failures.push(`${manifest.name} must not depend on ${providerPeer}`);
        }
        if (
          manifest.peerDependencies?.[providerPeer] &&
          manifest.peerDependenciesMeta?.[providerPeer]?.optional !== true
        ) {
          failures.push(`${manifest.name} must mark ${providerPeer} as optional`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("built entrypoints import successfully", async () => {
    expect(await runNodeImportSmoke()).toEqual([]);
  }, 20_000);

  it("declare every external package imported by built entrypoints", async () => {
    const failures: string[] = [];

    for (const packageDir of await packageDirectories()) {
      const distPath = join(packagesDir, packageDir, "dist", "index.js");
      const manifest = await readPackageManifest(packageDir);
      const dist = await readFile(distPath, "utf8");
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {})
      ]);

      for (const imported of importedPackages(dist)) {
        if (!declared.has(imported)) {
          failures.push(`${manifest.name} imports ${imported} from dist/index.js`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});

async function packageDirectories(): Promise<string[]> {
  return (await readdir(join(repoRoot, "packages"))).sort();
}

async function readPackageManifest(packageDir: string): Promise<PackageJson> {
  return JSON.parse(
    await readFile(join(repoRoot, "packages", packageDir, "package.json"), "utf8")
  ) as PackageJson;
}

async function readPackageReadme(packageDir: string): Promise<string> {
  try {
    return await readFile(join(repoRoot, "packages", packageDir, "README.md"), "utf8");
  } catch {
    return "";
  }
}

function expectedPackageKeywords(packageName: string): string[] {
  return [...commonPackageKeywords, ...(packageSpecificKeywords[packageName] ?? [])];
}

function runtimeReadmeNote(nodeEngine: string | undefined): string {
  if (nodeEngine === ">=20.0.0") {
    return "Requires Node.js 20 or newer";
  }
  return "Requires Node.js 22 or newer";
}

async function runNodeImportSmoke(): Promise<string[]> {
  const script = `
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = ${JSON.stringify(repoRoot)};
const failures = [];
for (const packageDir of (await readdir(resolve(repoRoot, "packages"))).sort()) {
  const distPath = resolve(repoRoot, "packages", packageDir, "dist", "index.js");
  try {
    await import(pathToFileURL(distPath).href);
  } catch (error) {
    failures.push(\`\${packageDir}: \${error instanceof Error ? error.message : String(error)}\`);
  }
}
console.log(JSON.stringify(failures));
if (failures.length > 0) {
  process.exitCode = 1;
}
`;

  try {
    const { stdout } = await execFile(
      process.execPath,
      ["--input-type=module", "-e", script],
      {
        cwd: repoRoot,
        maxBuffer: 1024 * 1024
      }
    );
    return JSON.parse(stdout) as string[];
  } catch (error) {
    const processError = error as {
      stderr?: string;
      stdout?: string;
    };
    const stdout = processError.stdout?.trim();
    const stderr = processError.stderr?.trim();
    return [
      [
        "node import smoke failed",
        stdout ? `stdout: ${stdout}` : undefined,
        stderr ? `stderr: ${stderr}` : undefined,
        `error: ${formatError(error)}`
      ]
        .filter(Boolean)
        .join("; ")
    ];
  }
}

interface PackageJson {
  dependencies?: Record<string, string>;
  description?: string;
  devDependencies?: Record<string, string>;
  engines?: {
    node?: string;
  };
  exports?: {
    "."?: {
      import?: string;
      types?: string;
    };
  };
  files?: string[];
  keywords?: string[];
  name: string;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<
    string,
    {
      optional?: boolean;
    }
  >;
  publishConfig?: {
    access?: string;
  };
  types?: string;
}

function importedPackages(source: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g,
    /import\(["']([^"']+)["']\)/g
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier || isBuiltinOrRelative(specifier)) {
        continue;
      }
      imports.add(packageName(specifier));
    }
  }

  return [...imports].sort();
}

function isBuiltinOrRelative(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    builtinSpecifiers.has(specifier)
  );
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) {
    return specifier.split("/").slice(0, 2).join("/");
  }
  return specifier.split("/")[0] ?? specifier;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
