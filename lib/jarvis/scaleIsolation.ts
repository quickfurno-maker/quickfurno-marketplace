import type { QfjScaleErrorClass } from "./scaleContract";

export const QFJ_SCALE_DEFAULTS = Object.freeze({
  timeoutMs: 2_500,
  maxTimeoutMs: 5_000,
  maxConcurrent: 8,
  maxQueued: 0,
  maxSockets: 8,
  maxFreeSockets: 2,
  breakerFailureThreshold: 5,
  breakerOpenMs: 15_000,
  halfOpenMaxProbes: 1,
  inlineRetries: 0,
} as const);

export class QfjIsolationFailure extends Error {
  readonly errorClass: QfjScaleErrorClass;
  readonly retryable: boolean;
  constructor(errorClass: QfjScaleErrorClass, retryable: boolean) {
    super(errorClass);
    this.name = "QfjIsolationFailure";
    this.errorClass = errorClass;
    this.retryable = retryable;
  }
}

export interface QfjIsolationSnapshot {
  readonly state: "CLOSED" | "OPEN" | "HALF_OPEN";
  readonly inFlight: number;
  readonly consecutiveFailures: number;
  readonly openUntilMs: number;
}

export class QfjIsolationGate {
  private inFlight = 0;
  private consecutiveFailures = 0;
  private openUntilMs = 0;
  private halfOpenProbe = false;

  constructor(
    private readonly config: Readonly<{
      maxConcurrent: number;
      breakerFailureThreshold: number;
      breakerOpenMs: number;
    }> = QFJ_SCALE_DEFAULTS,
  ) {
    if (
      !Number.isSafeInteger(config.maxConcurrent) ||
      config.maxConcurrent < 1 ||
      config.maxConcurrent > 256 ||
      !Number.isSafeInteger(config.breakerFailureThreshold) ||
      config.breakerFailureThreshold < 1 ||
      !Number.isSafeInteger(config.breakerOpenMs) ||
      config.breakerOpenMs < 100
    ) {
      throw new TypeError("QFJ_ISOLATION_CONFIG_INVALID");
    }
  }

  snapshot(nowMs = Date.now()): QfjIsolationSnapshot {
    const state =
      this.openUntilMs > nowMs
        ? "OPEN"
        : this.openUntilMs > 0
          ? "HALF_OPEN"
          : "CLOSED";
    return Object.freeze({
      state,
      inFlight: this.inFlight,
      consecutiveFailures: this.consecutiveFailures,
      openUntilMs: this.openUntilMs,
    });
  }

  async run<T>(args: {
    readonly deadlineAt: string;
    readonly task: (signal: AbortSignal) => Promise<T>;
    readonly now?: () => number;
  }): Promise<T> {
    const now = args.now ?? Date.now;
    const started = now();
    const deadlineMs = Date.parse(args.deadlineAt);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= started) {
      throw new QfjIsolationFailure("QFJ_DEADLINE_EXCEEDED", true);
    }

    const halfOpen = this.openUntilMs > 0 && this.openUntilMs <= started;
    if (this.openUntilMs > started) {
      throw new QfjIsolationFailure("QFJ_CIRCUIT_OPEN", true);
    }
    if (halfOpen) {
      if (this.halfOpenProbe) {
        throw new QfjIsolationFailure("QFJ_CIRCUIT_OPEN", true);
      }
      this.halfOpenProbe = true;
    } else if (this.inFlight >= this.config.maxConcurrent) {
      throw new QfjIsolationFailure("QFJ_BACKPRESSURE", true);
    }

    this.inFlight += 1;
    const controller = new AbortController();
    const timeoutMs = Math.max(1, deadlineMs - started);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const value = await args.task(controller.signal);
      this.consecutiveFailures = 0;
      this.openUntilMs = 0;
      return value;
    } catch (error) {
      const failure =
        error instanceof QfjIsolationFailure
          ? error
          : controller.signal.aborted
            ? new QfjIsolationFailure("QFJ_UPSTREAM_TIMEOUT", true)
            : new QfjIsolationFailure("QFJ_UPSTREAM_UNAVAILABLE", true);
      if (failure.retryable) {
        this.consecutiveFailures += 1;
        if (halfOpen || this.consecutiveFailures >= this.config.breakerFailureThreshold) {
          this.openUntilMs = now() + this.config.breakerOpenMs;
        }
      } else {
        this.consecutiveFailures = 0;
        this.openUntilMs = 0;
      }
      throw failure;
    } finally {
      clearTimeout(timer);
      this.inFlight -= 1;
      if (halfOpen) this.halfOpenProbe = false;
    }
  }
}
