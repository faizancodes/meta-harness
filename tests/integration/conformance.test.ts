import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockAdapter } from "@metaharness/adapter-mock";
import { ClaudeAdapter } from "@metaharness/claude";
import { CodexAdapter } from "@metaharness/codex";
import {
  UnsupportedCapabilityError,
  createHarness,
  parsePortableRunEvent,
  renderHandoffMarkdown
} from "@metaharness/core";
import { CursorAdapter } from "@metaharness/cursor";
import { describe, expect, it } from "vitest";
import type {
  CodingAgentAdapter,
  PortableRunEvent,
  ProviderCapabilities,
  ProviderConfig,
  ProviderId,
  RunInput,
  RunResult
} from "@metaharness/core";

interface ProviderConformanceTarget {
  adapter: CodingAgentAdapter;
  apiKeyEnv?: string;
  envFlag?: string;
  name?: string;
  native?: Record<string, unknown>;
  provider: ProviderId;
}

interface ConformanceContext {
  events: PortableRunEvent[];
  result: RunResult;
  target: ProviderConformanceTarget;
  workspace: string;
}

const providerTargets: ProviderConformanceTarget[] = [
  {
    adapter: new MockAdapter(),
    provider: "mock"
  },
  {
    adapter: new ClaudeAdapter(),
    apiKeyEnv: "ANTHROPIC_API_KEY",
    envFlag: "metaharness_TEST_CLAUDE",
    provider: "claude"
  },
  {
    adapter: new CursorAdapter(),
    apiKeyEnv: "CURSOR_API_KEY",
    envFlag: "metaharness_TEST_CURSOR",
    provider: "cursor"
  },
  {
    adapter: new CodexAdapter(),
    apiKeyEnv: "OPENAI_API_KEY",
    envFlag: "metaharness_TEST_CODEX",
    name: "codex sdk",
    native: {
      mode: "sdk"
    },
    provider: "codex"
  },
  {
    adapter: new CodexAdapter(),
    apiKeyEnv: "OPENAI_API_KEY",
    envFlag: "metaharness_TEST_CODEX_APPSERVER",
    name: "codex app-server",
    native: {
      mode: "app-server"
    },
    provider: "codex"
  }
];

for (const target of providerTargets) {
  const liveGateEnabled = target.envFlag ? process.env[target.envFlag] === "1" : true;
  const apiKeyPresent = target.apiKeyEnv ? Boolean(process.env[target.apiKeyEnv]) : true;
  const shouldRun = liveGateEnabled && apiKeyPresent;

  if (target.envFlag && liveGateEnabled && !apiKeyPresent) {
    describe(`${targetName(target)} conformance preflight`, () => {
      it(`requires ${target.apiKeyEnv} when ${target.envFlag}=1`, () => {
        expect(
          process.env[target.apiKeyEnv ?? ""],
          `Set ${target.apiKeyEnv} or unset ${target.envFlag} to skip live ${targetName(target)} conformance.`
        ).toBeTruthy();
      });
    });
    continue;
  }

  const suite = shouldRun ? describe : describe.skip;
  const skipReason = target.envFlag
    ? ` (${target.envFlag}=1 and ${target.apiKeyEnv} required for live run)`
    : "";
  const conformanceTimeoutMs = target.envFlag ? 120_000 : 30_000;

  suite(`${targetName(target)} provider conformance${skipReason}`, () => {
    it(
      "returns a complete capability matrix",
      async () => {
        await runConformanceCase(target, "capability matrix", async () => {
          const capabilities = await target.adapter.capabilities({
            cwd: process.cwd()
          });

          expect(capabilities.provider).toBe(target.provider);
          expect(capabilities.knownLimitations).toBeInstanceOf(Array);
          expectCapabilityMatrixComplete(capabilities);
        });
      },
      conformanceTimeoutMs
    );

    it(
      "streams portable events and completes a read-only summary run",
      async () => {
        await runConformanceCase(target, "streamed read-only run", async () => {
          const context = await executeConformanceRun(target);

          expect(context.result.provider).toBe(target.provider);
          expect(context.result.status).toBe("success");
          expect(context.events.length).toBeGreaterThan(0);
          expect(context.events.some((event) => event.type === "run.started")).toBe(true);
          expect(
            context.events.some(
              (event) =>
                event.type === "assistant.message.delta" ||
                event.type === "assistant.message.completed" ||
                event.type === "run.status" ||
                event.type === "run.completed"
            )
          ).toBe(true);
          expectMonotonicEvents(context.events);
        });
      },
      conformanceTimeoutMs
    );

    it(
      "runs an edit-style task and records a diff event when supported",
      async () => {
        await runConformanceCase(target, "edit and diff", async () => {
          const capabilities = await target.adapter.capabilities({
            cwd: process.cwd()
          });
          if (
            target.provider !== "mock" &&
            !capabilities.workspace.writeFiles.supported
          ) {
            return;
          }

          const workspace = await createTinyWorkspace(target.provider);
          const harness = createConformanceHarness(target, workspace);
          const active = await harness.startRun({
            desiredOutput: "patch",
            mode: "edit",
            policy: generalConformancePolicy(target, workspaceWriteConformancePolicy()),
            task: [
              "Create or update CONFORMANCE_EDIT.md.",
              "Write exactly one short sentence that says this workspace was edited by metaharness conformance.",
              "Keep the change minimal."
            ].join(" ")
          });
          const events: PortableRunEvent[] = [];
          const streamPromise = collectEvents(active.events(), events);
          const result = await active.wait();
          await streamPromise;
          await harness.dispose();

          expect(result.provider).toBe(target.provider);
          expect(result.status).toBe("success");
          expect(
            events.some((event) => event.type === "diff.updated") ||
              Boolean(result.diff || result.patchPath)
          ).toBe(true);
          expectMonotonicEvents(events);
        });
      },
      conformanceTimeoutMs
    );

    it(
      "fails a run when observed commands violate deny policy",
      async () => {
        await runConformanceCase(target, "deny command policy", async () => {
          const capabilities = await target.adapter.capabilities({
            cwd: process.cwd()
          });
          if (
            target.provider !== "mock" &&
            !capabilities.policy.commandAllowDeny.supported
          ) {
            return;
          }

          const workspace = await createTinyWorkspace(target.provider);
          const harness = createConformanceHarness(target, workspace);
          const result = await harness.run({
            mode: "ask",
            policy: denyCommandConformancePolicy(),
            task:
              target.provider === "mock"
                ? "Trigger the mock command policy denial."
                : [
                    "Attempt to run the shell command `echo metaharness-denied-command` exactly once.",
                    "If the command is denied by policy, report that denial and stop."
                  ].join(" ")
          });
          const recordedEvents = await readRecordedEvents(result);
          await harness.dispose();
          const observedDeniedCommand = recordedEvents.some(
            (event) =>
              (event.type === "command.started" || event.type === "command.finished") &&
              event.command.includes("metaharness-denied-command")
          );
          const commandPolicyViolation = recordedEvents.some(
            (event) =>
              event.type === "error" && event.error.code === "COMMAND_POLICY_VIOLATION"
          );

          expect(result.provider).toBe(target.provider);
          if (target.provider === "mock" || commandPolicyViolation) {
            expect(result.status).toBe("failed");
            expect(result.finalMessage).toContain("violated metaharness command policy");
            expect(commandPolicyViolation).toBe(true);
          } else {
            expect(observedDeniedCommand).toBe(false);
            expect(["success", "failed"]).toContain(result.status);
          }
        });
      },
      conformanceTimeoutMs
    );

    it(
      "honors active-run cancellation semantics",
      async () => {
        await runConformanceCase(target, "active-run cancellation", async () => {
          const capabilities = await target.adapter.capabilities({
            cwd: process.cwd()
          });
          const workspace = await createTinyWorkspace(target.provider);
          const harness = createConformanceHarness(target, workspace);
          const active = await harness.startRun({
            mode: "ask",
            native: mockNativeOptions(target, {
              eventDelayMs: 20
            }),
            policy: generalConformancePolicy(target, readOnlyConformancePolicy()),
            task: [
              "Start a cancellation conformance run.",
              "If cancellation is requested, stop without editing files."
            ].join(" ")
          });
          const events: PortableRunEvent[] = [];
          const runStarted = waitForEvent(events, "run.started");
          const streamPromise = collectEvents(active.events(), events);

          await runStarted;
          let cancelError: unknown;
          try {
            await active.cancel();
          } catch (error) {
            cancelError = error;
          }

          if (!capabilities.lifecycle.cancel.supported) {
            expect(cancelError).toBeInstanceOf(UnsupportedCapabilityError);
          } else if (cancelError) {
            expect(cancelError).toBeInstanceOf(UnsupportedCapabilityError);
          }

          const result = await active.wait();
          await streamPromise;
          await harness.dispose();

          expect(["success", "failed", "cancelled"]).toContain(result.status);
          expectMonotonicEvents(events);
          if (target.provider === "mock") {
            expect(cancelError).toBeUndefined();
            expect(result.status).toBe("cancelled");
            expect(events.at(-1)).toMatchObject({
              status: "cancelled",
              type: "run.completed"
            });
          }
        });
      },
      conformanceTimeoutMs
    );

    it(
      "resumes from ledger or native session state when available",
      async () => {
        await runConformanceCase(target, "resume lifecycle", async () => {
          const capabilities = await target.adapter.capabilities({
            cwd: process.cwd()
          });
          if (!capabilities.lifecycle.resume.supported) {
            return;
          }

          const context = await executeConformanceRun(target);
          const ledger = JSON.parse(
            await readFile(context.result.ledgerPath ?? "", "utf8")
          ) as Parameters<typeof renderHandoffMarkdown>[0];
          const nativeSessionId =
            context.result.nativeSessionId ?? ledger.provider.nativeSessionId;
          if (target.provider !== "mock" && !nativeSessionId) {
            expect(
              nativeSessionId,
              "resume-capable live providers should expose native session state for same-provider resume conformance"
            ).toBeTruthy();
            return;
          }

          const harness = createConformanceHarness(target, context.workspace);
          const result = await harness.resume({
            ledger,
            mode: "ask",
            nativeSessionId,
            policy: generalConformancePolicy(target, readOnlyConformancePolicy()),
            task: "Resume this conformance conversation and answer in one sentence."
          });
          await harness.dispose();

          expect(result.provider).toBe(target.provider);
          expect(result.status).toBe("success");
        });
      },
      conformanceTimeoutMs
    );

    it(
      "records valid events, result, ledger, and handoff artifacts",
      async () => {
        await runConformanceCase(target, "recorded artifacts", async () => {
          const context = await executeConformanceRun(target);

          expect(context.result.eventLogPath).toBeDefined();
          expect(context.result.ledgerPath).toBeDefined();
          expect(context.result.handoffPath).toBeDefined();

          const recordedEvents = await readRecordedEvents(context.result);
          expect(recordedEvents.length).toBeGreaterThan(0);
          expectMonotonicEvents(recordedEvents);
          for (const event of recordedEvents) {
            expect(parsePortableRunEvent(event)).toEqual(event);
            expect(event.type).not.toBe("provider.raw");
          }

          const ledger = JSON.parse(
            await readFile(context.result.ledgerPath ?? "", "utf8")
          ) as unknown;
          expect(ledger).toMatchObject({
            provider: {
              id: target.provider
            },
            schemaVersion: "metaharness.session-ledger.v1",
            task: {
              mode: "ask"
            }
          });

          const handoff = await readFile(context.result.handoffPath ?? "", "utf8");
          expect(handoff).toContain("metaharness handoff");
          expect(handoff).toContain(
            "does not transfer hidden provider-native session state"
          );
          expect(
            renderHandoffMarkdown(ledger as Parameters<typeof renderHandoffMarkdown>[0])
          ).toContain("metaharness handoff");
        });
      },
      conformanceTimeoutMs
    );
  });
}

async function executeConformanceRun(
  target: ProviderConformanceTarget
): Promise<ConformanceContext> {
  const workspace = await createTinyWorkspace(target.provider);
  const harness = createConformanceHarness(target, workspace);

  const activeRun = await harness.startRun({
    mode: "ask",
    policy: generalConformancePolicy(target, readOnlyConformancePolicy()),
    task: [
      "Summarize this tiny workspace in one concise sentence.",
      "Do not edit files or run network commands."
    ].join(" ")
  });

  const events: PortableRunEvent[] = [];
  const streamPromise = collectEvents(activeRun.events(), events);
  const result = await activeRun.wait();
  await streamPromise;
  await harness.dispose();

  return {
    events,
    result,
    target,
    workspace
  };
}

function createConformanceHarness(
  target: ProviderConformanceTarget,
  workspace: string
): ReturnType<typeof createHarness> {
  return createHarness(
    {
      defaultProvider: target.provider,
      providers: {
        [target.provider]: providerConfigForTarget(target)
      },
      rawEvents: false,
      storage: {
        redactSecrets: true
      },
      workspace: {
        cwd: workspace
      }
    },
    [target.adapter]
  );
}

function providerConfigForTarget(target: ProviderConformanceTarget): ProviderConfig {
  const providerConfig: ProviderConfig = {
    provider: target.provider,
    runtime: "local"
  };
  if (target.apiKeyEnv) {
    providerConfig.apiKeyEnv = target.apiKeyEnv;
  }
  if (target.provider === "codex") {
    providerConfig.native = {
      mode: "sdk",
      ...(target.native ?? {}),
      sandboxMode: "workspace-write"
    };
  } else if (target.native) {
    providerConfig.native = target.native;
  }
  return providerConfig;
}

function targetName(target: ProviderConformanceTarget): string {
  return target.name ?? target.provider;
}

function readOnlyConformancePolicy(): RunInput["policy"] {
  return {
    inline: {
      filesystem: {
        mode: "read-only"
      },
      commands: {
        allow: safeConformanceCommandAllowList(),
        default: "deny",
        deny: []
      },
      version: 1
    }
  };
}

function workspaceWriteConformancePolicy(): RunInput["policy"] {
  return {
    inline: {
      filesystem: {
        mode: "workspace-write"
      },
      commands: {
        allow: safeConformanceCommandAllowList(),
        default: "deny",
        deny: []
      },
      limits: {
        maxDiffBytes: 200_000,
        maxFilesChanged: 5
      },
      version: 1
    }
  };
}

function generalConformancePolicy(
  target: ProviderConformanceTarget,
  policy: RunInput["policy"]
): RunInput["policy"] {
  return target.provider === "mock" ? policy : undefined;
}

function safeConformanceCommandAllowList(): string[] {
  const fixtureFiles = ["README.md", "package.json"];
  const sedRanges = ["1,120p", "1,160p", "1,200p", "1,240p"];
  return [
    "mock verify",
    "/bin/zsh -lc 'rg --files'",
    "/bin/zsh -lc 'rg --files -uu'",
    ...fixtureFiles.flatMap((file) =>
      sedRanges.map((range) => `/bin/zsh -lc "sed -n '${range}' ${file}"`)
    )
  ];
}

function denyCommandConformancePolicy(): RunInput["policy"] {
  return {
    inline: {
      commands: {
        allow: [],
        default: "deny",
        deny: ["mock verify", "echo *"]
      },
      version: 1
    }
  };
}

function mockNativeOptions(
  target: ProviderConformanceTarget,
  options: Record<string, unknown>
): RunInput["native"] {
  return target.provider === "mock" ? { mock: options } : undefined;
}

async function createTinyWorkspace(provider: ProviderId): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), `metaharness-${provider}-conformance-`));
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify(
      {
        name: `metaharness-${provider}-fixture`,
        private: true,
        type: "module"
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await writeFile(
    join(cwd, "README.md"),
    "# Tiny fixture\n\nThis workspace exists for metaharness provider conformance.\n",
    "utf8"
  );
  return cwd;
}

async function collectEvents(
  source: AsyncIterable<PortableRunEvent>,
  target: PortableRunEvent[]
): Promise<void> {
  for await (const event of source) {
    target.push(event);
  }
}

async function waitForEvent(
  events: PortableRunEvent[],
  type: PortableRunEvent["type"]
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!events.some((event) => event.type === type)) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${type}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

async function readRecordedEvents(result: RunResult): Promise<PortableRunEvent[]> {
  const content = await readFile(result.eventLogPath ?? "", "utf8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => parsePortableRunEvent(JSON.parse(line)));
}

function expectMonotonicEvents(events: PortableRunEvent[]): void {
  let lastSeq = 0;
  for (const event of events) {
    expect(event.id).toBeTruthy();
    expect(event.ts).toBeTruthy();
    expect(event.provider).toBeTruthy();
    expect(event.runId).toBeTruthy();
    expect(event.sessionId).toBeTruthy();
    expect(event.seq).toBeGreaterThan(lastSeq);
    lastSeq = event.seq;
  }
}

function expectCapabilityMatrixComplete(capabilities: ProviderCapabilities): void {
  const sections: Record<string, readonly string[]> = {
    lifecycle: ["start", "stream", "wait", "cancel", "resume", "fork"],
    observability: [
      "tokenUsage",
      "cost",
      "planEvents",
      "diffEvents",
      "commandEvents",
      "fileChangeEvents",
      "toolCallEvents",
      "rawEventAccess"
    ],
    policy: [
      "filesystemSandbox",
      "commandAllowDeny",
      "networkControl",
      "humanApprovals",
      "providerNativePermissions"
    ],
    runtime: ["local", "cloud", "selfHosted"],
    tools: ["mcp", "skills", "subagents", "hooks", "webSearch"],
    workspace: [
      "readFiles",
      "writeFiles",
      "runCommands",
      "gitDiff",
      "gitBranch",
      "openPullRequest",
      "artifacts"
    ]
  };

  for (const [sectionName, keys] of Object.entries(sections)) {
    const section = capabilities[sectionName as keyof ProviderCapabilities] as Record<
      string,
      unknown
    >;
    for (const key of keys) {
      const flag = section[key] as { stability?: unknown; supported?: unknown };
      expect(flag, `${sectionName}.${key}`).toBeTruthy();
      expect(typeof flag.supported, `${sectionName}.${key}.supported`).toBe("boolean");
      expect(
        ["stable", "beta", "experimental", "unknown"],
        `${sectionName}.${key}.stability`
      ).toContain(flag.stability);
    }
  }
}

async function runConformanceCase(
  target: ProviderConformanceTarget,
  caseName: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[${targetName(target)}] ${caseName} conformance failed. ` +
        `Check provider SDK installation, ${target.apiKeyEnv ?? "local test config"}, and capability declarations. ` +
        message,
      {
        cause: error
      }
    );
  }
}
