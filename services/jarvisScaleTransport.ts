import http from "node:http";
import https from "node:https";

import {
  createQfjScaleMetadata,
  qfjScaleRetryable,
  signQfjScaleHeaders,
  type QfjScaleActor,
  type QfjScaleErrorClass,
  type QfjScaleMetadataV1,
} from "../lib/jarvis/scaleContract";
import {
  QFJ_SCALE_DEFAULTS,
  QfjIsolationFailure,
  QfjIsolationGate,
} from "../lib/jarvis/scaleIsolation";
import {
  activeTraceId,
  injectCurrentTraceHeaders,
  recordMetric,
  SpanKind,
  withSpan,
} from "../lib/observability/runtime";

export interface QfjScaleHttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type QfjScaleHttpPost = (
  url: string,
  init: {
    readonly method: "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
    readonly redirect: "error";
  },
) => Promise<QfjScaleHttpResponse>;

export type QfjScaleTransportResult =
  | {
      readonly ok: true;
      readonly response: QfjScaleHttpResponse;
      readonly metadata: QfjScaleMetadataV1;
    }
  | {
      readonly ok: false;
      readonly errorClass: QfjScaleErrorClass;
      readonly retryable: boolean;
      readonly metadata: QfjScaleMetadataV1;
    };

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxTotalSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxFreeSockets: QFJ_SCALE_DEFAULTS.maxFreeSockets,
});
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxTotalSockets: QFJ_SCALE_DEFAULTS.maxSockets,
  maxFreeSockets: QFJ_SCALE_DEFAULTS.maxFreeSockets,
});

const defaultGate = new QfjIsolationGate({
  maxConcurrent: QFJ_SCALE_DEFAULTS.maxConcurrent,
  breakerFailureThreshold: QFJ_SCALE_DEFAULTS.breakerFailureThreshold,
  breakerOpenMs: QFJ_SCALE_DEFAULTS.breakerOpenMs,
});

function protocolAllowed(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      url.hostname === "::1")
  );
}

function boundedNodePost(
  urlText: string,
  init: Parameters<QfjScaleHttpPost>[1],
): Promise<QfjScaleHttpResponse> {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return Promise.reject(new QfjIsolationFailure("QFJ_CONTRACT_INVALID", false));
  }
  if (!protocolAllowed(url)) {
    return Promise.reject(new QfjIsolationFailure("QFJ_CONTRACT_INVALID", false));
  }
  const transport = url.protocol === "https:" ? https : http;
  const agent = url.protocol === "https:" ? httpsAgent : httpAgent;

  return new Promise<QfjScaleHttpResponse>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "POST",
        headers: init.headers,
        agent,
        signal: init.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
          bytes += value.length;
          if (bytes > 65_536) {
            request.destroy(new Error("QFJ_RESPONSE_TOO_LARGE"));
            return;
          }
          chunks.push(value);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: response.statusCode ?? 503,
            async text() {
              return body;
            },
          });
        });
        response.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end(init.body);
  });
}

export function createJarvisScaleTransport(gate = defaultGate) {
  return async function postJarvisScale(args: {
    readonly url: string;
    readonly path: string;
    readonly body: string;
    readonly keyId: string;
    readonly privateKeyPem: string;
    readonly actor: QfjScaleActor;
    readonly requestId: string;
    readonly idempotencyKey: string;
    readonly expectedRevision?: number;
    readonly correlationId?: string;
    readonly traceId?: string;
    readonly timeoutMs?: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly httpPost?: QfjScaleHttpPost;
  }): Promise<QfjScaleTransportResult> {
    const startedAt = performance.now();
    return withSpan(
      "quickfurno.jarvis.client",
      SpanKind.CLIENT,
      {
        "server.address": (() => {
          try {
            return new URL(args.url).hostname;
          } catch {
            return "invalid";
          }
        })(),
        "http.request.method": "POST",
        "qfj.route": args.path,
      },
      async () => {
        const timeoutMs = args.timeoutMs ?? QFJ_SCALE_DEFAULTS.timeoutMs;
        const activeId = activeTraceId();
        const selectedTraceId = args.traceId ?? activeId ?? undefined;
        const metadata = createQfjScaleMetadata({
          requestId: args.requestId,
          idempotencyKey: args.idempotencyKey,
          actor: args.actor,
          timeoutMs,
          ...(args.expectedRevision === undefined
            ? {}
            : { expectedRevision: args.expectedRevision }),
          ...(args.correlationId === undefined
            ? {}
            : { correlationId: args.correlationId }),
          ...(selectedTraceId === undefined ? {} : { traceId: selectedTraceId }),
        });
        const raw = Buffer.from(args.body, "utf8");
        const scaleHeaders = signQfjScaleHeaders({
          method: "POST",
          path: args.path,
          metadata,
          keyId: args.keyId,
          privateKeyPem: args.privateKeyPem,
          rawBody: raw,
        });
        const post = args.httpPost ?? boundedNodePost;
        const baseHeaders = Object.freeze({
          ...(args.headers ?? {}),
          ...scaleHeaders,
        });
        const headers =
          activeId !== null && activeId === metadata.traceId
            ? injectCurrentTraceHeaders(baseHeaders)
            : baseHeaders;

        try {
          const response = await gate.run({
            deadlineAt: metadata.deadlineAt,
            task: async (signal) => {
              const value = await post(args.url, {
                method: "POST",
                redirect: "error",
                signal,
                headers,
                body: args.body,
              });
              if (value.status === 429) {
                throw new QfjIsolationFailure("QFJ_BACKPRESSURE", true);
              }
              if (value.status >= 500) {
                throw new QfjIsolationFailure("QFJ_UPSTREAM_UNAVAILABLE", true);
              }
              return value;
            },
          });
          recordMetric("qf.provider.delivery.duration", performance.now() - startedAt, {
            provider: "jarvis",
            result: response.status < 400 ? "success" : "refused",
          });
          return { ok: true, response, metadata };
        } catch (error) {
          const failure =
            error instanceof QfjIsolationFailure
              ? error
              : new QfjIsolationFailure("QFJ_UPSTREAM_UNAVAILABLE", true);
          recordMetric("qf.provider.delivery.duration", performance.now() - startedAt, {
            provider: "jarvis",
            result: failure.errorClass,
          });
          return {
            ok: false,
            errorClass: failure.errorClass,
            retryable: qfjScaleRetryable(failure.errorClass),
            metadata,
          };
        }
      },
    );
  };
}

export const postJarvisScale = createJarvisScaleTransport();

export function jarvisScaleIsolationSnapshot() {
  return defaultGate.snapshot();
}
