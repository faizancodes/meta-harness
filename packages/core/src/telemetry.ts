import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes, Span } from "@opentelemetry/api";

const tracer = trace.getTracer("@metaharness/core", "0.0.0");

export type SpanAttributeInput = Record<string, boolean | number | string | undefined>;
export type HarnessSpan = Pick<Span, "setAttributes">;

export function spanAttributes(input: SpanAttributeInput): Attributes {
  const attributes: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      attributes[key] = value;
    }
  }
  return attributes;
}

export async function withHarnessSpan<T>(
  name: string,
  attributes: Attributes,
  callback: (span: Span) => Promise<T>
): Promise<T> {
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await callback(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

export function withHarnessSpanSync<T>(
  name: string,
  attributes: Attributes,
  callback: (span: Span) => T
): T {
  return tracer.startActiveSpan(name, { attributes }, (span) => {
    try {
      const result = callback(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}

function recordSpanError(span: Span, error: unknown): void {
  const normalized =
    error instanceof Error ? error : new Error(String(error ?? "Unknown error"));
  span.recordException(normalized);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: normalized.message
  });
}
