import { describe, expect, it } from "vitest";
import {
  isProviderId,
  supportedProviderIdList,
  validateHarnessConfig
} from "../src/index.js";

describe("config validation", () => {
  it("accepts valid harness config objects", () => {
    const result = validateHarnessConfig({
      workspace: { cwd: process.cwd() },
      defaultProvider: "mock",
      providers: {
        mock: { provider: "mock" }
      }
    });

    expect(result).toEqual({
      success: true,
      config: {
        workspace: { cwd: process.cwd() },
        defaultProvider: "mock",
        providers: {
          mock: { provider: "mock" }
        }
      }
    });
  });

  it("reports non-object config exports separately", () => {
    const result = validateHarnessConfig(undefined);

    expect(result).toEqual({
      success: false,
      reason: "not_object",
      diagnostics: ["config must be an object."]
    });
  });

  it("returns actionable diagnostics for provider and schema mismatches", () => {
    const result = validateHarnessConfig({
      workspace: { cwd: process.cwd() },
      defaultProvider: "openai",
      providers: {
        openai: { provider: "openai" },
        mock: { provider: "codex", runtime: "serverless" }
      }
    });

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.reason).toBe("schema");
    expect(result.diagnostics).toContain(
      `Unsupported defaultProvider "openai". Supported providers: ${supportedProviderIdList}.`
    );
    expect(result.diagnostics).toContain(
      `providers.openai is not supported. Supported providers: ${supportedProviderIdList}.`
    );
    expect(result.diagnostics).toContain(
      'providers.mock.provider must be "mock", got "codex".'
    );
    expect(
      result.diagnostics.some((item) => item.startsWith("providers.mock.runtime:"))
    ).toBe(true);
    expect(result.diagnostics.some((item) => item.startsWith("defaultProvider:"))).toBe(
      false
    );
  });

  it("exports the provider id guard used by developer tooling", () => {
    expect(isProviderId("codex")).toBe(true);
    expect(isProviderId("openai")).toBe(false);
  });
});
