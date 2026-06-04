# @metaharness/telemetry

OpenTelemetry setup helpers for metaharness applications and CLI wrappers.

## Install

```bash
pnpm add @metaharness/telemetry
```

## Use

```ts
import { initializeTelemetry } from "@metaharness/telemetry";

const telemetry = initializeTelemetry({
  enabled: true,
  exporter: "otlp",
  serviceName: "my-metaharness-worker"
});

try {
  // Run metaharness work here.
} finally {
  await telemetry?.shutdown();
}
```

For tests, use in-memory telemetry:

```ts
import { initializeInMemoryTelemetry } from "@metaharness/telemetry";

const telemetry = initializeInMemoryTelemetry();
await telemetry.forceFlush();
await telemetry.shutdown();
```

## Notes

- Requires Node.js 22 or newer.
- Supported exporters are `none`, `console`, and `otlp`.
- Invalid exporter values fail with `TELEMETRY_EXPORTER_UNSUPPORTED`.
- In-memory test telemetry fails with `TELEMETRY_TRACER_PROVIDER_CONFLICT` if
  another global tracer provider is already registered; call `shutdown()` on the
  existing telemetry handle before creating a new one. See `docs/error-codes.md`
  in the metaharness repository for the full list.
- Environment variables such as `METAHARNESS_OTEL_EXPORTER` and
  `METAHARNESS_OTEL_SERVICE_NAME` override default options. The package also
  accepts `metaharness_OTEL_EXPORTER`, `metaharness_OTEL_SERVICE_NAME`, and
  `metaharness_OTEL_SERVICE_VERSION`; when both forms are set, the
  `metaharness_OTEL_*` value takes precedence.
- Always call `shutdown()` before process exit in long-running workers and
  integration tests.
- For support routes, issue templates, and sensitive artifact guidance, see
  `SUPPORT.md` in the metaharness repository.
