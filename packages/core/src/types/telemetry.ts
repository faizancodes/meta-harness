export interface TelemetryConfig {
  enabled?: boolean;
  serviceName?: string;
  serviceVersion?: string;
  exporter?: "none" | "console" | "otlp";
}
