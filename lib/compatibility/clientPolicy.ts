// Phase 23 — public/native client compatibility policy.
// Existing Next.js web routes remain server-coupled. Native/external clients must
// use an explicit API major and are never silently interpreted as another major.

export const QF_API_CURRENT_MAJOR = 1 as const;
export const QF_API_MINIMUM_SUPPORTED_MAJOR = 1 as const;

export const QF_CLIENT_HEADERS = Object.freeze({
  platform: "x-qf-client-platform",
  version: "x-qf-client-version",
  build: "x-qf-client-build",
  apiMajor: "x-qf-api-major",
} as const);

export const QF_CLIENT_PLATFORMS = ["web", "ios", "android"] as const;
export type QfClientPlatform = (typeof QF_CLIENT_PLATFORMS)[number];

export type NativeMinimumVersions = Readonly<{
  ios: string | null;
  android: string | null;
}>;

export type ClientCompatibilityDecision =
  | { readonly allowed: true; readonly mode: "server-coupled" | "supported" | "not-enforced" }
  | {
      readonly allowed: false;
      readonly mode: "unsupported-api-major" | "upgrade-required" | "invalid-version";
      readonly httpStatus: 400 | 426;
    };

function parseTriplet(value: string): readonly [number, number, number] | null {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every(Number.isSafeInteger)
    ? ([parts[0]!, parts[1]!, parts[2]!] as const)
    : null;
}

function compareTriplet(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index]! < right[index]!) return -1;
    if (left[index]! > right[index]!) return 1;
  }
  return 0;
}

export function evaluateClientCompatibility(input: {
  readonly platform: QfClientPlatform;
  readonly clientVersion: string | null;
  readonly apiMajor: number | null;
  readonly nativePolicyActivated: boolean;
  readonly minimumVersions: NativeMinimumVersions;
}): ClientCompatibilityDecision {
  if (input.platform === "web") {
    return { allowed: true, mode: "server-coupled" };
  }

  if (input.apiMajor !== QF_API_CURRENT_MAJOR) {
    return { allowed: false, mode: "unsupported-api-major", httpStatus: 400 };
  }

  if (!input.nativePolicyActivated) {
    return { allowed: true, mode: "not-enforced" };
  }

  if (input.clientVersion === null) {
    return { allowed: false, mode: "invalid-version", httpStatus: 400 };
  }

  const current = parseTriplet(input.clientVersion);
  const minimumText = input.minimumVersions[input.platform];
  if (!current || minimumText === null) {
    return minimumText === null
      ? { allowed: true, mode: "supported" }
      : { allowed: false, mode: "invalid-version", httpStatus: 400 };
  }

  const minimum = parseTriplet(minimumText);
  if (!minimum) {
    return { allowed: false, mode: "invalid-version", httpStatus: 400 };
  }

  return compareTriplet(current, minimum) >= 0
    ? { allowed: true, mode: "supported" }
    : { allowed: false, mode: "upgrade-required", httpStatus: 426 };
}

export function buildVersionedIdempotencyScope(input: {
  readonly apiMajor: number;
  readonly operation: string;
  readonly key: string;
}): string {
  if (!Number.isSafeInteger(input.apiMajor) || input.apiMajor < 1) {
    throw new TypeError("invalid-api-major");
  }
  if (!/^[a-z0-9][a-z0-9._:-]{1,79}$/u.test(input.operation)) {
    throw new TypeError("invalid-operation");
  }
  if (!/^[A-Za-z0-9._:-]{1,160}$/u.test(input.key)) {
    throw new TypeError("invalid-idempotency-key");
  }
  return `v${String(input.apiMajor)}:${input.operation}:${input.key}`;
}
