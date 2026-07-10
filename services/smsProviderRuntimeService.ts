// ============================================================================
// QuickFurno — services/smsProviderRuntimeService.ts   (Phase 5F-C2, server-only)
//
// A READ-ONLY projection of the generic communication provider registries into the PURE
// SMS runtime gate. It reuses the EXISTING tables — no SMS-specific duplicate exists:
//
//   communication_provider_runtime_policies      (channel 'sms')
//   communication_provider_accounts              (channel 'sms')
//   communication_provider_template_mappings     (channel 'sms')
//   communication_provider_canary_destinations   (channel 'sms')
//
// It NEVER writes, never activates, never mutates a policy, never claims an authentication
// attempt, never calls a provider, and never dispatches anything. It answers exactly one
// question: "could the SMS infrastructure carry a message right now?"
//
// SMS_RUNTIME_READY IS NOT FALLBACK AUTHORIZATION. Whether an authentication action may
// fall back to SMS is decided only by Phase 5F-C1's decision engine, which additionally
// requires an operational transport policy, an explicit active failure rule, a proven
// definitive failure, an attempt budget and an atomic attempt claim.
//
// The queries deliberately fetch BROADLY (all accounts for the provider, all mappings for
// the template) and let the PURE gate discriminate. A query must never silently pick a row.
//
// Because no commercial SMS provider exists, no SMS provider account, runtime policy,
// template mapping or canary row is seeded anywhere — so live production naturally and
// permanently returns SMS_RUNTIME_BLOCKED.
// ============================================================================

import { adminClient } from "../lib/supabase";
import {
  SMS_CHANNEL,
  SMS_RUNTIME_BLOCKED,
  SmsRuntimeBlockReason,
  evaluateSmsRuntimeGate,
  type SmsCanaryDestinationRow,
  type SmsProviderAccountRow,
  type SmsRuntimeDecision,
  type SmsRuntimePolicyRow,
  type SmsTemplateMappingRow,
} from "../lib/communication/providers/smsRuntimeGate";

const RUNTIME_POLICY_TABLE = "communication_provider_runtime_policies";
const PROVIDER_ACCOUNT_TABLE = "communication_provider_accounts";
const TEMPLATE_MAPPING_TABLE = "communication_provider_template_mappings";
const CANARY_DESTINATION_TABLE = "communication_provider_canary_destinations";

export interface SmsRuntimeReadinessQuery {
  readonly providerKey: string;
  /** The candidate adapter's declared channel — the gate refuses anything but `sms`. */
  readonly channel: string;
  readonly templateKey: string;
  readonly language: string;
  /** Non-reversible destination hash. NEVER a plaintext number. */
  readonly destinationHash: string;
  /** Injectable for deterministic tests; the gate owns no clock. */
  readonly now?: number | string | Date;
}

/** The exact runtime policy row for (provider, sms), or null. */
export async function readSmsRuntimePolicy(providerKey: string): Promise<SmsRuntimePolicyRow | null> {
  const { data, error } = await adminClient()
    .from(RUNTIME_POLICY_TABLE)
    .select("*")
    .eq("provider_key", providerKey)
    .eq("channel", SMS_CHANNEL)
    .maybeSingle();
  if (error || !data) return null;
  return data as SmsRuntimePolicyRow;
}

/**
 * EVERY account row for this provider, on every channel. The gate — not the query —
 * decides whether an sms account exists, is ambiguous, or is on the wrong channel.
 */
export async function readSmsProviderAccounts(providerKey: string): Promise<SmsProviderAccountRow[]> {
  const { data, error } = await adminClient()
    .from(PROVIDER_ACCOUNT_TABLE)
    .select("*")
    .eq("provider_key", providerKey);
  if (error) throw error;
  return (data ?? []) as SmsProviderAccountRow[];
}

/**
 * EVERY mapping row for this template key. The gate decides channel/provider/language/
 * approval/active/category/ambiguity — a query must never silently select one.
 */
export async function readSmsTemplateMappings(templateKey: string): Promise<SmsTemplateMappingRow[]> {
  const { data, error } = await adminClient()
    .from(TEMPLATE_MAPPING_TABLE)
    .select("*")
    .eq("template_key", templateKey);
  if (error) throw error;
  return (data ?? []) as SmsTemplateMappingRow[];
}

/** Active canary allowlist rows for this (provider, sms, destination hash). */
export async function readSmsCanaryDestinations(
  providerKey: string,
  destinationHash: string
): Promise<SmsCanaryDestinationRow[]> {
  const { data, error } = await adminClient()
    .from(CANARY_DESTINATION_TABLE)
    .select("*")
    .eq("provider_key", providerKey)
    .eq("channel", SMS_CHANNEL)
    .eq("destination_hash", destinationHash)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []) as SmsCanaryDestinationRow[];
}

/**
 * Project the registries into the pure gate and return its decision. FAIL CLOSED on a
 * missing row, a database error, an ambiguous account or mapping, a mismatched provider or
 * channel, or any invalid state. Nothing is written; nothing is dispatched.
 */
export async function evaluateSmsRuntimeReadiness(
  query: SmsRuntimeReadinessQuery
): Promise<SmsRuntimeDecision> {
  try {
    const [policy, accounts, mappings, canaryRows] = await Promise.all([
      readSmsRuntimePolicy(query.providerKey),
      readSmsProviderAccounts(query.providerKey),
      readSmsTemplateMappings(query.templateKey),
      readSmsCanaryDestinations(query.providerKey, query.destinationHash),
    ]);

    return evaluateSmsRuntimeGate({
      providerKey: query.providerKey,
      channel: query.channel,
      templateKey: query.templateKey,
      language: query.language,
      destinationHash: query.destinationHash,
      policy,
      accounts,
      mappings,
      canaryRows,
      now: query.now ?? Date.now(),
    });
  } catch {
    // A read failure is a BLOCK, never an approval. No detail leaks a row or an error text.
    return { status: SMS_RUNTIME_BLOCKED, reason: SmsRuntimeBlockReason.RUNTIME_READ_FAILED };
  }
}
