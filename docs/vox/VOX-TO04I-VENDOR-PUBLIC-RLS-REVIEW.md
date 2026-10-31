# VOX TO-04I — Live vendor-support RLS and public-directory security review

**Read-only QuickFurno production/staging metadata checked 15 October 2026; RELEASE HOLD.** No live role, policy, table or view changes authorized.

### Confirmed differences

| Object/permission | Staging | Production |
|---|---|---|
| `vendor_support_threads` RLS | Enabled | Enabled |
| `anon` SELECT/INSERT/UPDATE/DELETE table grants | No | Yes |
| `authenticated` SELECT/INSERT/UPDATE/DELETE table grants | No | Yes |
| `vendor_support_threads` owner/admin RLS predicates | Present | Present |
| Anonymous RLS policy on vendor-support threads | None | None |
| `vendor_public_v` anonymous SELECT | Yes | Yes |
| `vendor_public_v` security invoker | No | No |
| `is_admin()`, `owns_vendor(uuid)` | SECURITY DEFINER, auth-only executable, uses `auth.uid()` | Same |

**Interpretation:** Production's thread grants are broader at the relation ACL layer, but RLS remains active. This is a risk deserving authenticated/anonymous real token E2E, *not* proof of a data breach. Staging's missing authenticated grants may make it a misleading test of permitted vendor-owner writes. Unconditional permission revocation or copying staging ACLs to production could break Vendor Support.

**Public-directory constraint:** `vendor_public_v` is intentionally readable by anonymous users, filtered to `Approved`, `is_active`, `public_visibility` and `remaining_credits > 0` vendors. Blindly changing to `security_invoker=true` while the vendors table lacks anonymous SELECT rights may make the public directory empty. An independently reviewed migration must prove equivalent public-only rows and no private columns via a synthetic anonymous account before applying. Do not grant broad `vendors` SELECT to anon as a workaround.

**Privileged Core functions:** `public.is_admin()` and `public.owns_vendor(uuid)` use `auth.uid()`, and `anon` lacks EXECUTE in both projects. They remain advisor findings requiring source ownership, correct admin principal enforcement, schema-qualified search paths and RLS/grant review. Do not blindly revoke or recreate them because existing vendor owner/admin policies depend on the helpers.

### Protected live staging validation still required
1. Independently reconcile 86 migration entries and restore actual SQL before staging VOX migrations.
2. Security reviewer and DBA inspect exact policies, grants, view output, and function dependencies; select a signed change plan and rollback.
3. Using **real synthetic Supabase Auth** and a protected staging release, assert anonymous support-thread SELECT/INSERT/UPDATE/DELETE are denied; authenticated unrelated vendor reads/writes are denied; true vendor owner can view/create/update only permitted threads; existing sole Superadmin can operate as designed. Verify public directory remains public-only, correctly filtered.
4. Check that revoking Staff/TL object grants immediately removes Core VOX access. JARVIS Anisha external send/handover remains off until provider consent and idempotent outbox are independently certified.
5. Only after protected human signoff, verified backup/restore, signed immutable OCI and rollback may activation be considered.

**Automated source CI asserts the release remains HOLD.** It does not conduct live synthetic Auth or authorize production permission changes.
