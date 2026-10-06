# ADR — Identity and Auth Provider Portability

Status: **LOCKED by Phase 20**  
Decision date: 2026-10-06

## Context

QuickFurno currently uses Supabase Auth. Existing business tables contain UUID references derived from `auth.users.id`, and RLS helpers use `auth.uid()`. Rewriting every historical row only to introduce an abstraction would add migration risk without improving launch correctness.

## Decision

1. **Do not mass-rewrite existing business IDs in Phase 20.**
2. Treat a Supabase user ID as an **external provider identity**, not the permanent conceptual business identity for new architecture.
3. Phase 22 will introduce/standardize a stable internal **principal identity** and a provider mapping containing internal principal ID, provider key, provider subject/user ID, and lifecycle/status metadata.
4. The authentication adapter owns provider-specific session/JWT/sign-in behavior.
5. **Authorization remains Core-owned.** Provider/user-editable metadata must never become the source of privilege.
6. New domains should avoid spreading direct provider semantics further where practical; existing stable UUID references remain untouched until a measured migration requires change.
7. A future provider migration may invalidate sessions and require credential-specific migration/re-enrollment. Business records must not need to be rewritten simply because the IdP changes.

## Launch implication

Supabase Auth remains the current provider and is not a launch blocker. The architecture decision makes provider independence explicit without pretending Phase 22's adapter/mapping rehearsal has already been completed.
