# TO-02C — independently reviewed multi-department capability transactions

**Source-only/nondeployable SQL candidate and synthetic PG17 tests.** The code is in `ops/vox/sql-candidates/` on a draft branch stacked on PR #265. Nothing is in deployable `supabase/migrations/` and no new managed Staging/Production data or grants exist.

## Candidate transaction boundaries
- Request: freshly verified existing Core Superadmin actor (AAL2 MUST be checked in Core bearer gateway), neutral existing VOX Staff target and active exact Core membership/team/city, allowed pack, bounded expiry, reason, unique nonce and audit event.
- Review: a distinct currently active Core Team Leader in the same verified team (trusted `vox_role` and neutral Staff identity); no Admin or target self-review, expected revision zero, one immutable decision and audit event.
- Activation: existing Core Superadmin finalizes after independently reviewed exact request, current Team Leader still authorized, target neutral profile and membership/city still active, expected revision one, unique unrevoked staff/team/pack; creates only department capability record and activation/audit event in same DB transaction. **Does not create object scope, client access or permission to send WhatsApp**.
- Revocation: existing Superadmin, revision two, row locked and atomically marked revoked revision three with durable event; duplicate/stale rejection. Existing emergency STAFF_REVOKE still takes precedence at Core access verification, even if this capability's row has not been separately marked revoked.
- RPCs grant EXECUTE exclusively to `service_role`; they **must never be callable by browser/anon/authenticated roles**.

## Important limitations before implementing callable Core HTTP endpoints
1. Supabase Auth JWT + AAL2 validation is **NOT** inside these database procedures; the existing Core Auth gateway MUST derive actor IDs and independently verify current user and AAL2 before calling any RPC. Never accept actor UUID supplied by the browser. A compromised service-role client can bypass these contracts; minimize its deployment exposure.
2. A current neutral Staff membership and independent review are required, but capability creation alone does not grant any record. A future strict reader must intersect AAL2, immutable user, city/team membership, current active capability, per-record `vox_staff_object_scopes_v1` permission and chat consent/handover.
3. The old single staff_role and existing `qf_vox_activate_reviewed_access_v1` remain authoritative; this candidate doesn't change either.
4. Riya Client 360 is not authorized by existing `conversation` grants, which cover prospect/vendor subjects only. Dedicated client ID/city/source semantics require independent review before client inbox access.
5. Synthetic PostgreSQL tests verify one positive owner→TL→owner activation/revocation flow, anti-replay/stale/owner-self-approve, role denial and RPC privileges. They do NOT prove safe migration onto the real restored 86-row history, true concurrency soak, tenant-level IDOR, runtime Auth AAL2, session revocation, email invites, provider messaging, rollback or human approval.
6. Do not move SQL into deployable migrations or activate Core RPC HTTP routes without independent DBA/security review, stage backup & genuine PostgreSQL restore, operator/governed change authorization and protected signed staging release.

## Independent deployment blockers remain
JARVIS PC off. VOX first-stage Core draft stack unmerged. GitHub protected staging has owner-only reviewer, independent review required. SQL source archive historic aliases require DBA and owner signoff. No staff invitation executed. No Supabase Auth management keys used. No EOD/WhatsApp send.
