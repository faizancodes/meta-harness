import { pathToFileURL } from "node:url";
import { MockAdapter } from "@metaharness/adapter-mock";
import { createHarness, defineConfig } from "@metaharness/core";

export async function runSdkBasicExample(cwd = process.cwd()): Promise<void> {
  const config = defineConfig({
    workspace: {
      cwd
    },
    defaultProvider: "mock",
    providers: {
      mock: { provider: "mock" }
    },
    storage: {
      rootDir: ".harness",
      redactSecrets: true
    },
    rawEvents: false
  });

  const harness = createHarness(config, [new MockAdapter()]);

  try {
    const doctor = await harness.doctor({ provider: "mock" });
    const failedChecks = doctor.checks.filter((check) => check.status === "fail");
    if (failedChecks.length > 0) {
      throw new Error(
        `Mock provider setup failed: ${failedChecks.map((check) => check.name).join(", ")}`
      );
    }

    const agent = harness.agent("mock");
    const caps = await agent.capabilities();

    console.log(`provider ${agent.provider}`);
    console.log(`streaming ${caps.lifecycle.stream.supported ? "yes" : "no"}`);

    const active = await agent.startRun({
      mode: "ask",
      task: "Summarize this workspace from the SDK TypeScript example."
    });

    for await (const event of active.events()) {
      if (event.type === "assistant.message.delta") {
        process.stdout.write(event.text);
      }
    }

    const result = await active.wait();
    const ledger = await harness.exportLedger(result.runId);

    console.log("");
    console.log(`status ${result.status}`);
    console.log(`run ${result.runId}`);
    console.log(`ledger ${result.ledgerPath}`);
    console.log(`handoff ${result.handoffPath}`);
    console.log(`changed ${ledger.files.changed.map((file) => file.path).join(", ")}`);
  } finally {
    await harness.dispose();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runSdkBasicExample();
}
