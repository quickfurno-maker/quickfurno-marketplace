#!/usr/bin/env node
// ============================================================================
// QF-MVP-40.13C-R1 — strict Core provider-env gate for the LATER staging Core start.
//
// Deliberately a SEPARATE entry point. Emergency `--disable` must never inherit these
// requirements: closing a gate cannot be allowed to depend on a complete provider
// configuration. This gate is the opposite case — it runs immediately before a real Core
// is started against staging, where a half-configured or contradictory provider identity
// is exactly what must refuse.
//
// It proves:
//   * every operator-local QF_META_* alias equals its canonical WHATSAPP_* counterpart;
//   * WHATSAPP_PROVIDER_MODE is exactly `meta_cloud`;
//   * WHATSAPP_APP_SECRET and WHATSAPP_WEBHOOK_VERIFY_TOKEN are present.
//
// It reads no database, makes no network call, and prints NO value — only variable names
// on failure. Importing it does nothing.
// ============================================================================

import { verifyCoreProviderEnv } from "./canaryActivationRuntime.mjs";

const isDirect = process.argv[1]
  && process.argv[1].endsWith("verify-core-provider-env.mjs");

if (isDirect) {
  const result = verifyCoreProviderEnv(process.env);
  if (!result.ok) {
    console.error(`REFUSED: ${result.reason}`);
    if (Array.isArray(result.fields) && result.fields.length > 0) {
      // Names only. A value is never printed.
      console.error(`Variables      : ${result.fields.join(", ")}`);
    }
    console.error("The staging Core must NOT be started until this passes.");
    process.exit(2);
  }
  console.log(`Aliases reconciled : ${result.reconciledAliases}`);
  console.log(`Provider mode      : ${result.providerMode}`);
  console.log("Webhook secrets    : present");
  console.log("QF_MVP_40_CORE_PROVIDER_ENV_VERIFIED");
  process.exit(0);
}
