import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  configJsonSchema,
  eventJsonSchema,
  sessionLedgerJsonSchema
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

describe("JSON schema artifacts", () => {
  it("keeps committed schema files in sync with core schema generators", async () => {
    await expectSchemaFile("schemas/metaharness.config.schema.json", configJsonSchema());
    await expectSchemaFile("schemas/event.schema.json", eventJsonSchema());
    await expectSchemaFile(
      "schemas/session-ledger.schema.json",
      sessionLedgerJsonSchema()
    );
  });
});

async function expectSchemaFile(path: string, schema: unknown): Promise<void> {
  const committed = JSON.parse(await readFile(resolve(repoRoot, path), "utf8"));
  expect(committed).toEqual(schema);
}
