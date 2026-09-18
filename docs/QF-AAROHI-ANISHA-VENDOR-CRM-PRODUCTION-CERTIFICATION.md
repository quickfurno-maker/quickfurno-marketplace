# QF Aarohi -> Anisha Vendor CRM Production Certification

**Date:** 2026-09-18  
**Production project:** QuickFurno (`yqpgcsduqbxulrlzwzap`)  
**Migration:** `20260918093000_aarohi_anisha_vendor_crm_handoff.sql`  
**Canonical SHA-256:** `d2f071040b004bab3d8589a5f8f56dedec2201e5663806eba320ee7a971c99f9`

## Outcome

The Aarohi-to-Anisha handoff bridge was applied exactly once to QuickFurno production from an isolated, production-linked migration workspace after an exact-one dry run.

The governed lifecycle is now:

`Aarohi acquisition -> canonical vendor approved/active/verified/paid -> Aarohi WON/COMPLETED/PAID -> Vendor CRM source=AAROHI, owner=ANISHA`.

Aarohi remains acquisition-only. The bridge does not create vendors, packages, payments, lead assignments, consent, provider mappings, or send authority.

## Deployment evidence

Before apply, production remote migration history contained **49** versions and `20260918093000` was absent. The isolated workspace aligned those already-applied versions with empty history placeholders and included the exact canonical bridge migration as the only new local version.

The production dry run reported exactly one migration:

```
20260918093000_aarohi_anisha_vendor_crm_handoff.sql
```

The migration was pushed once. The independent post-apply re-list showed **50** local/remote aligned versions and `20260918093000` present remotely.

## Independent database verification

Connected Supabase verification after apply proved:

- all **6** Vendor CRM acquisition-lineage columns are present;
- `qf_aarohi_complete_handoff_v1` remains `SECURITY DEFINER`;
- `anon` cannot execute the handoff RPC;
- `authenticated` cannot execute the handoff RPC;
- `service_role` can execute the handoff RPC;
- production migration history contains `20260918093000 / aarohi_anisha_vendor_crm_handoff`.

At verification time, production had **0 Aarohi handoff rows** and **0 AAROHI-sourced Vendor CRM profiles**, so no synthetic production record was inserted for testing.

The Supabase security advisor did not identify the new Aarohi handoff RPC among browser-executable SECURITY DEFINER functions. Existing advisor findings remain separately governed; the intentional Aarohi RLS-with-no-browser-policy posture is consistent with service-role-only access.

## Authority boundary

The handoff RPC first verifies Core-owned canonical vendor truth: Approved status, active flag, verified status, and a paid active package or paid activated package order. Only after those checks pass does it close acquisition and initialize Anisha's Vendor CRM relationship state.

The bridge writes acquisition provenance to `vendor_crm_profiles`, preserves the observed acquisition channel, writes Aarohi prospect/handoff lineage IDs, and appends an onboarding note. It does not manufacture the Core facts that authorize the handoff.

## Certification marker

`QF_AAROHI_ANISHA_VENDOR_CRM_PRODUCTION_APPLIED_AND_VERIFIED`

**Status:** PRODUCTION_APPLIED_VERIFIED
