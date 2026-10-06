# Phase 22 — Identity & Auth Provider Independence

Status: IMPLEMENTED / certification gate pending merge

Phase 22 introduces a stable internal identity plane without rewriting existing QuickFurno business IDs or changing production authentication.

## Locked model

Authentication providers prove an external subject only. QuickFurno maps that subject to a stable internal principal and then maps that principal to existing Core business records. Authorization remains entirely Core-owned.

The persistence model is additive:

- `identity_principals` — stable internal principals independent of any IdP.
- `identity_provider_identities` — provider key + external subject → internal principal.
- `identity_business_bindings` — internal principal → existing profile/client/vendor-dashboard records.
- `identity_admin_roles` — Core-owned scoped admin authorization, separated from provider claims.

Existing `auth.users` foreign keys, `auth.uid()` RLS policies, marketplace UUIDs and business rows are deliberately not rewritten. Supabase remains the current provider during coexistence.

## Live inventory

At Phase 22 start, QuickFurno has PostgreSQL 17.6, 9 Auth users, 9 Auth identities (all current provider `email`), 19 active sessions, zero MFA factors, 9 profiles, 8 vendor dashboard users and no client-account rows. Five public foreign keys target `auth.users`, and seven current public RLS policies use `auth.uid()`.

Runtime inventory records every direct Auth SDK call. Provider-specific login/session/recovery operations are explicitly classified as adapter or coexistence surfaces rather than being treated as business identity.

## Authorization boundary

Provider `user_metadata` is never authorization input. Provider claims cannot grant vendor/client/admin access.

The existing one Superadmin scope currently stored in trusted Supabase `app_metadata` is copied once into `identity_admin_roles`. The provider copy is retained only for legacy coexistence; the Phase 22 provider-neutral path reads the Core-owned role. The Superadmin operator script now persists both the existing compatibility marker and the Core authority record.

Business access continues to depend on existing Core state:

- vendor access: active `vendor_dashboard_users` membership + existing vendor record;
- client access: active `client_accounts` record;
- admin access: `profiles.role='admin'` + Core-owned `identity_admin_roles`.

No role/package/credit/verification state is copied into the provider mapping.

## Provider cutover rules

A future IdP cutover does not bridge or preserve old provider sessions. Users re-authenticate. Refresh tokens are never copied between providers merely to avoid sign-in.

Password-hash portability is not assumed. If the destination provider cannot securely import the source credential representation through a documented supported flow, affected users reset/re-enroll credentials.

MFA factor portability is not assumed. Factors are re-enrolled unless the destination IdP provides an explicitly verified migration mechanism. Recovery mechanisms are treated the same way.

Token TTLs stay bounded, and old JWT signing keys are not shared with a new provider solely to keep old sessions alive.

## Migration safety

The Phase 22 SQL migration is additive and designed for a coexistence window. It backfills provider links and business bindings without updating marketplace rows. New Auth users receive a stable principal through the existing onboarding trigger while preserving the current vendor/neutral profile classification rules.

Provider directory tables are RLS-enabled and server-only. `anon` and `authenticated` receive no table privileges. Security-definer trigger helpers use a locked search path and have untrusted EXECUTE revoked.

The migration is source/CI only in this phase. Production Supabase is not modified and no production session is invalidated.

## Exit gate

Phase 22 is complete only when an alternate test provider authenticates a subject that maps to the same stable principal and the same existing Core business record as the current Supabase subject, while provider-supplied role claims cannot change authorization. Disabled provider links/principals and suspended Core business state must fail closed. Existing marketplace rows and RLS policies must remain unchanged.

**Next:** Phase 23 — API & Event Compatibility Contracts.
