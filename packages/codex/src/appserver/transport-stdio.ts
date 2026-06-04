import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { CodexAppServerClientConfig } from "./protocol.js";

export interface CodexAppServerStdioTransport {
  process: ChildProcessWithoutNullStreams;
  stderrTail(): string;
}

export function spawnCodexAppServer(
  config: CodexAppServerClientConfig
): CodexAppServerStdioTransport {
  const child = spawn(config.command, config.args, {
    env: {
      ...process.env,
      ...(config.env ?? {})
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const stderrChunks: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrChunks.push(chunk);
    if (stderrChunks.length > 20) {
      stderrChunks.splice(0, stderrChunks.length - 20);
    }
  });
  return {
    process: child,
    stderrTail: () => stderrChunks.join("")
  };
}
