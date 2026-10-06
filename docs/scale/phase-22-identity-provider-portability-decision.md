# Phase 22 Design Input — Identity & Auth Provider Portability Decision

Status: architecture decision only. Phase 22 remains a future growth phase.

## Decision
QuickFurno Core owns **authorization and stable principal identity**. Supabase Auth remains the current authentication provider implementation.

The current provider subject (`auth.users.id`) must not become the permanent business identity contract for future systems.

## Future target
Introduce a provider-neutral principal model through expand/contract migration:
- `principal_id`: QuickFurno-owned immutable UUID;
- identity mapping: `(provider, provider_subject) -> principal_id`;
- business tables reference `principal_id`;
- auth adapter validates provider session/token and resolves one principal;
- Core authorization continues to use QuickFurno roles/ownership/consent, not provider claims as business truth.

## Current couplings that must be migrated deliberately
Live snapshot found direct public-schema references to `auth.users` in:
- `client_accounts.user_id`
- `password_reset_grants.user_id`
- `profiles.id`
- `vendor_dashboard_users.user_id`
- `verification_challenges.user_id`

These are inventory items, not a reason for a risky launch-time rewrite.

## Migration pattern
1. expand: add internal `principal_id` and provider identity mapping;
2. backfill current Supabase subjects into mapping;
3. dual-resolve/dual-write while old FKs remain valid;
4. reconcile every principal and authorization path;
5. switch reads to internal principal;
6. contract provider-specific FKs only after rollback window closes.

## Provider swap boundary
A future Cognito/Auth0/Keycloak/OIDC/Supabase replacement changes:
- authentication adapter,
- token/session validation,
- provider identity mapping,
- password/MFA/recovery/session migration mechanics.

It must **not** redesign:
- lead/credit/payment authority,
- vendor/client ownership semantics,
- consent/suppression,
- Jarvis proposal boundary,
- AGNI approval authority.

## Known migration limitations
Password hashes, refresh sessions, MFA factors, recovery state and some provider metadata may not be losslessly portable. Phase 22 must choose a safe re-authentication/reset strategy instead of promising impossible transparent migration.

## Launch decision
Do not delay launch for this refactor. Preserve the adapter boundary now, inventory the couplings, and perform the expand/contract migration only when provider independence is justified.
