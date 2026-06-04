import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseVerificationCommand, runVerificationCommands } from "../src/index.js";

describe("runVerificationCommands", () => {
  it("writes a stable log when no verification commands are configured", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-verification-empty-"));
    const outputPath = join(cwd, "verification.log");

    const results = await runVerificationCommands(undefined, {
      cwd,
      outputPath,
      redactSecrets: true
    });

    expect(results).toEqual([]);
    expect(await readFile(outputPath, "utf8")).toBe(
      "No verification commands configured.\n"
    );
  });

  it("redacts command lines and command output in verification logs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-verification-redact-"));
    const outputPath = join(cwd, "verification.log");
    const token = "sk-123456789012345678901234567890";

    const results = await runVerificationCommands([`echo ${token}`], {
      cwd,
      outputPath,
      redactSecrets: true
    });

    expect(results).toEqual([
      expect.objectContaining({
        command: `echo ${token}`,
        exitCode: 0,
        outputPath,
        summary: "[REDACTED]"
      })
    ]);
    const log = await readFile(outputPath, "utf8");
    expect(log).toContain("$ echo [REDACTED]");
    expect(log).toContain("[REDACTED]");
    expect(log).not.toContain(token);
  });

  it("parses verification commands into direct argv arrays", () => {
    expect(parseVerificationCommand('pnpm test --filter "@scope/pkg"')).toEqual({
      argv: ["pnpm", "test", "--filter", "@scope/pkg"],
      ok: true
    });
    expect(parseVerificationCommand("node -e 'console.log(1)'")).toEqual({
      argv: ["node", "-e", "console.log(1)"],
      ok: true
    });
  });

  it("rejects shell operators instead of executing verification through a shell", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "metaharness-verification-shell-"));
    const outputPath = join(cwd, "verification.log");
    const command = "pnpm test && echo should-not-run";

    expect(parseVerificationCommand(command)).toEqual({
      ok: false,
      reason:
        "Verification command contains shell operators; metaharness verification requires a direct argv command."
    });

    const results = await runVerificationCommands([command], {
      cwd,
      outputPath,
      redactSecrets: true
    });

    expect(results).toEqual([
      {
        command,
        exitCode: 1,
        outputPath,
        summary:
          "Verification command contains shell operators; metaharness verification requires a direct argv command."
      }
    ]);
    const log = await readFile(outputPath, "utf8");
    expect(log).toContain("$ pnpm test && echo should-not-run");
    expect(log).toContain("requires a direct argv command");
    expect(log).not.toContain("exit 0");
  });

  it("rejects inline shell interpreter verification commands", () => {
    expect(parseVerificationCommand("sh -c 'echo should-not-run'")).toEqual({
      ok: false,
      reason:
        "Verification command invokes a shell with inline code; metaharness verification requires a direct argv command."
    });
  });
});
