import {
  HarnessError,
  isProviderId,
  supportedProviderIdList,
  supportedProviderIds
} from "@metaharness/core";
import type { ProviderId } from "@metaharness/core";

export const supportedProviders = supportedProviderIds;
export const supportedProviderList = supportedProviderIdList;

export function parseProviderId(value: string, optionName = "provider"): ProviderId {
  if (isProviderId(value)) {
    return value;
  }
  throw new HarnessError(
    `Unsupported ${optionName} "${value}". Supported providers: ${supportedProviderList}.`,
    "PROVIDER_UNSUPPORTED"
  );
}

export function parseProviderList(
  value: string | undefined,
  optionName = "--providers",
  options: {
    dedupe?: boolean;
  } = {}
): ProviderId[] {
  const parts = (value ?? "mock")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    throw new HarnessError(`Missing ${optionName}.`, "PROVIDER_MISSING");
  }

  const providers: ProviderId[] = [];
  const seen = new Set<ProviderId>();
  for (const provider of parts) {
    const parsed = parseProviderId(provider);
    if (!options.dedupe || !seen.has(parsed)) {
      providers.push(parsed);
      seen.add(parsed);
    }
  }
  return providers;
}
