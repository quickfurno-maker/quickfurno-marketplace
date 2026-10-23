# 3B-9B — Independent AppSec review request (NO APPROVAL RECORDED)
**Recipient:** qualified independent security reviewer to be designated by Owner. This request is NOT an independent review or signoff.

**Scope:** 69 Staging `pg_policies` directly captured read-only at Phase3B7 (59 reference `public.is_admin()`, 22 reference `public.owns_vendor(uuid)`, overlap 12). Distribution 32 SELECT, 28 ALL, 6 INSERT, 3 UPDATE; 37 policies affect writes or ALL commands. Every policy requires individually signed effective compositional analysis, not bulk approval.

**Fresh Staging observation (23 Oct 2026):** `is_admin()` is SECURITY DEFINER, checks authenticated UID and `role='admin'` but not active profile; `owns_vendor(uuid)` checks UID/ID match but not suspension. Changing either function globally may break legitimate historical read paths or widen access through a permissive OR policy. Evaluate exact composed effective privileges per table, target role, inherited grants and session freshness.

**Reviewer deliverables:**
- For every row in `STEP3B9-INDEPENDENT-REVIEW-HANDOFF-20261023.json`, explain SELECT/INSERT/UPDATE/DELETE or ALL, `USING` plus `WITH CHECK`, permissive OR + restrictive AND, SECURITY DEFINER grants, function owner and `search_path`. Review `vendor_public_v` security-definer discovery behavior rather than indiscriminately changing it.
- Demonstrate revoked/inactive Admin denial and suspended vendor denial of new work, writes, dispatch and outward communication; independently decide historic invoice/refund/dispute read access and prove cross-tenant denial.
- Recheck stale JWT, actual Supabase session revocation, scoped permissions, initial Team Leader authority, storage policies, signed Jarvis callbacks, issuer/audience and CSRF/origin protections.
- Propose exact SQL diff and adverse-impact test plan; independently approve or reject exact-SHA candidate and effective PostgreSQL17 tests in a managed-like isolated environment. **Do not modify Staging RLS until approved.**

**Human-only signoff:** status PENDING. Reviewer: NOT ASSIGNED. Per-policy effective test evidence: NONE. SQL approval: NONE. Managed RLS changes authorized: NO.
