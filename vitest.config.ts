import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repoRoot = fileURLToPath(new URL(".", import.meta.url));
const alias = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const packageAliases = {
  "@metaharness/adapter-mock": alias("./packages/adapter-mock/src/index.ts"),
  "@metaharness/claude": alias("./packages/claude/src/index.ts"),
  "@metaharness/cli": alias("./packages/cli/src/index.ts"),
  "@metaharness/codex": alias("./packages/codex/src/index.ts"),
  "@metaharness/core": alias("./packages/core/src/index.ts"),
  "@metaharness/cursor": alias("./packages/cursor/src/index.ts"),
  "@metaharness/github-action": alias("./packages/github-action/src/index.ts"),
  "@metaharness/policy": alias("./packages/policy/src/index.ts"),
  "@metaharness/telemetry": alias("./packages/telemetry/src/index.ts")
};

const project = (name: string, include: string[]) => ({
  test: {
    alias: packageAliases,
    include,
    name
  }
});

export default defineConfig({
  root: repoRoot,
  test: {
    environment: "node",
    exclude: ["**/dist/**", "**/node_modules/**"],
    projects: [
      project("core", ["packages/core/test/**/*.test.ts"]),
      project("adapter-mock", ["packages/adapter-mock/test/**/*.test.ts"]),
      project("policy", ["packages/policy/test/**/*.test.ts"]),
      project("telemetry", ["packages/telemetry/test/**/*.test.ts"]),
      project("claude", ["packages/claude/test/**/*.test.ts"]),
      project("cursor", ["packages/cursor/test/**/*.test.ts"]),
      project("codex", ["packages/codex/test/**/*.test.ts"]),
      project("cli", ["packages/cli/test/**/*.test.ts"]),
      project("github-action", ["packages/github-action/test/**/*.test.ts"]),
      project("integration", ["tests/integration/**/*.test.ts"])
    ],
    watch: false
  }
});
