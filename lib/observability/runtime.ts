import {
  context,
  metrics,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type TextMapGetter,
} from "@opentelemetry/api";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import type { QfRuntimeIdentity } from "../runtime/deploymentConfig";

export interface QfObservabilityRuntime {
  readonly enabled: boolean;
  shutdown(): Promise<void>;
}
const SAFE_LABELS = new Set([
  "service","route","method","status_class","worker_role","lane","operation","result",
  "provider","model_tier","event","stage",
]);
const BOUNDED = /^[A-Za-z0-9._:/-]{1,96}$/u;
let runtime: QfObservabilityRuntime | undefined;

function collectorEndpoint(env: NodeJS.ProcessEnv): string | null {
  const value = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString().replace(/\/$/u, "")
      : null;
  } catch {
    return null;
  }
}
function boundedIdentity(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && BOUNDED.test(normalized) ? normalized : fallback;
}
export function boundedMetricAttributes(
  input: Readonly<Record<string, string | number | boolean>>,
): Attributes {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!SAFE_LABELS.has(key)) throw new TypeError(`otel_metric_label_refused:${key}`);
    if (typeof value === "string" && !BOUNDED.test(value)) {
      throw new TypeError(`otel_metric_value_refused:${key}`);
    }
    output[key] = value;
  }
  return output;
}
export function startQfObservability(
  identity: QfRuntimeIdentity,
  env: NodeJS.ProcessEnv = process.env,
): QfObservabilityRuntime {
  if (runtime !== undefined) return runtime;
  const base = collectorEndpoint(env);
  if (env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true" || base === null) {
    runtime = Object.freeze({ enabled: false, async shutdown() {} });
    return runtime;
  }
  try {
    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: identity.serviceId,
        [ATTR_SERVICE_VERSION]: boundedIdentity(env.QF_BUILD_SHA, "unknown"),
        [ATTR_SERVICE_INSTANCE_ID]: boundedIdentity(
          env.QF_SERVICE_INSTANCE_ID,
          `${identity.serviceId}:unknown`,
        ),
        "deployment.environment.name": identity.environment,
        "qf.image.sha": boundedIdentity(env.QF_IMAGE_SHA, "unknown"),
        "qf.migration.head": boundedIdentity(env.QF_MIGRATION_HEAD, "unknown"),
        "qf.config.schema.version": identity.schemaVersion,
      }),
      traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
      metricReaders: [new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: 15_000,
      })],
      logRecordProcessors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }),
        }),
      ],
    });
    sdk.start();
    const heartbeat = () => {
      try {
        setMetric("qf.telemetry.heartbeat.unixtime", Math.floor(Date.now() / 1000), {
          stage: "heartbeat",
        });
      } catch {
        // Telemetry is powerless and must never affect customer traffic.
      }
    };
    heartbeat();
    const heartbeatTimer = setInterval(heartbeat, 15_000);
    heartbeatTimer.unref();
    runtime = Object.freeze({
      enabled: true,
      async shutdown() {
        clearInterval(heartbeatTimer);
        await sdk.shutdown();
      },
    });
    return runtime;
  } catch {
    runtime = Object.freeze({ enabled: false, async shutdown() {} });
    return runtime;
  }
}
const meter = () => metrics.getMeter("qfj.phase14", "1");
const tracer = () => trace.getTracer("qfj.phase14", "1");
const counters = new Map<string, ReturnType<ReturnType<typeof meter>["createCounter"]>>();
const histograms = new Map<string, ReturnType<ReturnType<typeof meter>["createHistogram"]>>();
const gauges = new Map<string, ReturnType<ReturnType<typeof meter>["createGauge"]>>();

export function addMetric(
  name: string, value: number,
  attributes: Readonly<Record<string, string | number | boolean>>,
): void {
  const safe = boundedMetricAttributes(attributes);
  let instrument = counters.get(name);
  if (instrument === undefined) {
    instrument = meter().createCounter(name);
    counters.set(name, instrument);
  }
  instrument.add(value, safe);
}
export function recordMetric(
  name: string, value: number,
  attributes: Readonly<Record<string, string | number | boolean>>,
): void {
  const safe = boundedMetricAttributes(attributes);
  let instrument = histograms.get(name);
  if (instrument === undefined) {
    instrument = meter().createHistogram(name);
    histograms.set(name, instrument);
  }
  instrument.record(value, safe);
}
export function setMetric(
  name: string, value: number,
  attributes: Readonly<Record<string, string | number | boolean>>,
): void {
  const safe = boundedMetricAttributes(attributes);
  let instrument = gauges.get(name);
  if (instrument === undefined) {
    instrument = meter().createGauge(name);
    gauges.set(name, instrument);
  }
  instrument.record(value, safe);
}
export function emitStructuredLog(
  severity: "INFO" | "WARN" | "ERROR",
  eventName: string,
  attributes: Attributes = {},
): void {
  logs.getLogger("qfj.phase14", "1").emit({
    severityNumber: severity === "ERROR"
      ? SeverityNumber.ERROR
      : severity === "WARN" ? SeverityNumber.WARN : SeverityNumber.INFO,
    severityText: severity,
    eventName,
    body: eventName,
    attributes,
  });
}
export async function withSpan<T>(
  name: string,
  kind: SpanKind,
  attributes: Attributes,
  task: () => Promise<T>,
  parent?: Context,
): Promise<T> {
  return tracer().startActiveSpan(
    name,
    { kind, attributes },
    parent ?? context.active(),
    async (span) => {
      try {
        const value = await task();
        span.setStatus({ code: SpanStatusCode.OK });
        return value;
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.addEvent("operation.failed", { "error.type": "bounded_observability_error" });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
const headerGetter: TextMapGetter<Record<string, string | string[] | undefined>> = {
  keys(carrier) { return Object.keys(carrier); },
  get(carrier, key) { return carrier[key.toLowerCase()] ?? carrier[key]; },
};
export function extractRemoteContext(
  headers: Record<string, string | string[] | undefined>,
): Context {
  return propagation.extract(context.active(), headers, headerGetter);
}
export function captureCurrentTraceContext(): Readonly<{
  traceparent?: string;
  tracestate?: string;
}> {
  const headers = injectCurrentTraceHeaders();
  const traceparent = headers["traceparent"];
  const tracestate = headers["tracestate"];
  return Object.freeze({
    ...(traceparent === undefined ? {} : { traceparent }),
    ...(tracestate === undefined ? {} : { tracestate }),
  });
}
export function injectCurrentTraceHeaders(
  base: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  const carrier: Record<string, string> = { ...base };
  propagation.inject(context.active(), carrier);
  return Object.freeze(carrier);
}
export function activeTraceId(): string | null {
  const id = trace.getSpan(context.active())?.spanContext().traceId;
  return id && !/^0{32}$/u.test(id) ? id : null;
}
export { SpanKind, SpanStatusCode, trace };
