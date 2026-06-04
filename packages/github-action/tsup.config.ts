import { defineConfig } from "tsup";

export default defineConfig({
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"
  },
  clean: true,
  dts: true,
  entry: ["src/index.ts"],
  external: ["@anthropic-ai/claude-agent-sdk", "@cursor/sdk", "@openai/codex-sdk"],
  format: ["esm"],
  noExternal: [
    /^(?!@anthropic-ai\/claude-agent-sdk$)(?!@cursor\/sdk$)(?!@openai\/codex-sdk$).*/
  ],
  platform: "node",
  skipNodeModulesBundle: false,
  sourcemap: true,
  splitting: false,
  target: "node20"
});
