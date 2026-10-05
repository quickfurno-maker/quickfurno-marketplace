import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { config as loadDotEnv } from "dotenv";

export const QF_CONFIG_SCHEMA_VERSION = "1" as const;
export const QF_RUNTIME_ENVIRONMENTS = ["local", "staging", "production"] as const;
export type QfRuntimeEnvironment = (typeof QF_RUNTIME_ENVIRONMENTS)[number];

export interface QfRuntimeIdentity {
  readonly schemaVersion: typeof QF_CONFIG_SCHEMA_VERSION;
  readonly environment: QfRuntimeEnvironment;
  readonly serviceId: string;
}

const SERVICE_ID = /^quickfurno\.[a-z0-9][a-z0-9.-]{1,95}$/;

function runtimeEnvironment(value: string | undefined): QfRuntimeEnvironment | null {
  const normalized = value?.trim().toLowerCase();
  return QF_RUNTIME_ENVIRONMENTS.includes(normalized as QfRuntimeEnvironment)
    ? (normalized as QfRuntimeEnvironment)
    : null;
}

export function loadQfRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): void {
  const explicit = env.QF_ENV_FILE?.trim();
  const productionLike =
    env.NODE_ENV === "production" || runtimeEnvironment(env.QF_RUNTIME_ENV) === "production";

  if (productionLike) {
    if (!explicit) return;
    if (!isAbsolute(explicit)) throw new Error("QF_ENV_FILE_MUST_BE_ABSOLUTE_IN_PRODUCTION");
    if (!existsSync(explicit)) throw new Error("QF_ENV_FILE_NOT_FOUND");
    loadDotEnv({ path: explicit, override: false });
    return;
  }

  const candidates = [explicit, ".env.local", ".env.production", ".env"].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const path = isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
    if (!existsSync(path)) continue;
    loadDotEnv({ path, override: false });
    if (explicit) break;
  }
}

export function assertQfRuntimeIdentity(
  expectedServiceId: string,
  env: NodeJS.ProcessEnv = process.env,
): QfRuntimeIdentity {
  const environment = runtimeEnvironment(env.QF_RUNTIME_ENV);
  if (environment === null) throw new Error("QF_RUNTIME_ENV_INVALID");
  if (env.QF_CONFIG_SCHEMA_VERSION?.trim() !== QF_CONFIG_SCHEMA_VERSION) {
    throw new Error("QF_CONFIG_SCHEMA_VERSION_UNSUPPORTED");
  }
  const serviceId = env.QF_SERVICE_ID?.trim() ?? "";
  if (!SERVICE_ID.test(serviceId) || serviceId !== expectedServiceId) {
    throw new Error("QF_SERVICE_ID_INVALID");
  }
  if (env.NODE_ENV === "production" && environment !== "production") {
    throw new Error("QF_RUNTIME_ENV_MISMATCH");
  }
  return Object.freeze({
    schemaVersion: QF_CONFIG_SCHEMA_VERSION,
    environment,
    serviceId,
  });
}
