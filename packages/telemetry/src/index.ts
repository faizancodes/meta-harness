import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  InMemorySpanExporter,
  SimpleSpanProcessor
} from "@opentelemetry/sdk-trace-base";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION
} from "@opentelemetry/semantic-conventions";
import type { TelemetryConfig } from "@metaharness/core";
import type { SpanExporter } from "@opentelemetry/sdk-trace-base";

export type TelemetryExporter = "console" | "none" | "otlp";

export interface InitializeTelemetryOptions extends TelemetryConfig {
  env?: Record<string, string | undefined>;
}

export interface ResolvedTelemetryOptions {
  exporter: TelemetryExporter;
  serviceName: string;
  serviceVersion?: string;
}

export interface TelemetryHandle {
  exporter: TelemetryExporter;
  shutdown(): Promise<void>;
}

export interface InMemoryTelemetryHandle {
  exporter: "memory";
  forceFlush(): Promise<void>;
  provider: BasicTracerProvider;
  shutdown(): Promise<void>;
  spanExporter: InMemorySpanExporter;
}

export interface TelemetryErrorDetails {
  option?: string;
  value?: unknown;
}

export class TelemetryError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = "TelemetryError";
  }
}

export class TelemetryConfigError extends TelemetryError {
  constructor(
    message: string,
    code = "TELEMETRY_CONFIG_INVALID",
    public readonly details: TelemetryErrorDetails = {}
  ) {
    super(message, code);
    this.name = "TelemetryConfigError";
  }
}

export class TelemetrySetupError extends TelemetryError {
  constructor(message: string, code = "TELEMETRY_SETUP_FAILED") {
    super(message, code);
    this.name = "TelemetrySetupError";
  }
}

export function initializeTelemetry(
  options: InitializeTelemetryOptions = {}
): TelemetryHandle | undefined {
  const resolved = resolveTelemetryOptions(options);
  if (resolved.exporter === "none") {
    return undefined;
  }

  const sdk = new NodeSDK({
    resource: telemetryResource(resolved),
    traceExporter: createTraceExporter(resolved.exporter)
  });
  sdk.start();

  return {
    exporter: resolved.exporter,
    shutdown: async () => {
      await sdk.shutdown();
      trace.disable();
    }
  };
}

export function initializeInMemoryTelemetry(
  options: Omit<InitializeTelemetryOptions, "exporter"> = {}
): InMemoryTelemetryHandle {
  const env = {
    ...(options.env ?? {}),
    METAHARNESS_OTEL_EXPORTER: "none",
    metaharness_OTEL_EXPORTER: "none"
  };
  const resolved = resolveTelemetryOptions({
    ...options,
    env,
    exporter: "none"
  });
  const spanExporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    resource: telemetryResource(resolved),
    spanProcessors: [new SimpleSpanProcessor(spanExporter)]
  });
  const registered = trace.setGlobalTracerProvider(provider);
  if (!registered) {
    throw new TelemetrySetupError(
      "OpenTelemetry global tracer provider is already registered. Call shutdown() on the existing telemetry handle before initializing in-memory telemetry again.",
      "TELEMETRY_TRACER_PROVIDER_CONFLICT"
    );
  }

  return {
    exporter: "memory",
    forceFlush: () => provider.forceFlush(),
    provider,
    shutdown: async () => {
      await provider.shutdown();
      trace.disable();
    },
    spanExporter
  };
}

export function resolveTelemetryOptions(
  options: InitializeTelemetryOptions = {}
): ResolvedTelemetryOptions {
  const env = options.env ?? process.env;
  const envExporter = env.metaharness_OTEL_EXPORTER ?? env.METAHARNESS_OTEL_EXPORTER;
  const exporter = normalizeExporter(
    envExporter ?? options.exporter ?? (options.enabled ? "otlp" : "none")
  );
  const serviceName =
    env.metaharness_OTEL_SERVICE_NAME ??
    env.METAHARNESS_OTEL_SERVICE_NAME ??
    env.OTEL_SERVICE_NAME ??
    options.serviceName ??
    "metaharness";
  const serviceVersion =
    env.metaharness_OTEL_SERVICE_VERSION ??
    env.METAHARNESS_OTEL_SERVICE_VERSION ??
    options.serviceVersion;

  const resolved: ResolvedTelemetryOptions = {
    exporter,
    serviceName
  };
  if (serviceVersion) {
    resolved.serviceVersion = serviceVersion;
  }
  return resolved;
}

function createTraceExporter(exporter: Exclude<TelemetryExporter, "none">): SpanExporter {
  switch (exporter) {
    case "console":
      return new ConsoleSpanExporter();
    case "otlp":
      return new OTLPTraceExporter();
  }
}

function telemetryResource(options: ResolvedTelemetryOptions) {
  const attributes: Record<string, string> = {
    [ATTR_SERVICE_NAME]: options.serviceName
  };
  if (options.serviceVersion) {
    attributes[ATTR_SERVICE_VERSION] = options.serviceVersion;
  }
  return resourceFromAttributes(attributes);
}

function normalizeExporter(value: string | undefined): TelemetryExporter {
  const normalized = value?.toLowerCase();
  if (!normalized || normalized === "none") {
    return "none";
  }
  if (normalized === "console" || normalized === "otlp") {
    return normalized;
  }
  throw new TelemetryConfigError(
    `Unsupported metaharness telemetry exporter "${value}". Expected console, otlp, or none.`,
    "TELEMETRY_EXPORTER_UNSUPPORTED",
    {
      option: "exporter",
      value
    }
  );
}
