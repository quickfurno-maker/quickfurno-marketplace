# VOX-16C — Existing staging Supabase security findings and compatibility gate

**RELEASE HOLD.** 14 October 2026 first-party Supabase Staging Security Advisor (project `uckafzuochmbvtiodmcl`) found:

| Severity | Finding | Existing canonical dependency | Status |
|---|---|---|---|
| ERROR | `public.vendor_public_v` uses SECURITY DEFINER view semantics | This view permits publicly filtered vendor listing even though `vendors` RLS currently has authenticated owner/admin rules, **no anon SELECT policy** | OPEN; do not silently change to `security_invoker=true` without creating and testing safely scoped public listing policy |
| WARN 2 | `is_admin()`, `owns_vendor(p_vendor_id uuid)` SECURITY DEFINER RPCs callable to `authenticated` | Existing `vendors` RLS uses `is_admin()`. `owns_vendor` verifies auth.uid against vendor user_id. Do not blind-revoke if client RLS depends on them | OPEN; dependency graph, search_path hardening and actor spoof tests required |
| WARN 1 | Auth leaked-password protection disabled | Supabase Auth console provider setting | OPEN; requires owner/admin provider setting; no application code change can turn it on |
| INFO 102 | RLS enabled but no policies | Multiple intentionally private service-only Aarohi and marketplace tables | REVIEW PER TABLE; no blanket anonymous/authenticated grants |

Evidence: live `pg_get_viewdef('public.vendor_public_v')` projects approved, active, visible, credited vendor rows; underlying `vendors` policies `vendors admin all` and `vendors owner read/update` rely on current verified identity. A naive view `security_invoker=true` could remove all public vendor listings; adding public `vendors` SELECT grant without safe RLS could leak private vendor fields. This is **not automatically repaired**. A reviewed compatibility-safe approach must preserve only public allowlisted columns/conditions under correct caller RLS.

Official documentation: [Security definer view advisory](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [Authenticated SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [Leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Code checks in this PR confirm the gated VOX AAL2, per-city scope, HUMAN revision and existing v3 atomic approval boundaries are retained, not that these existing Supabase findings are resolved. No live SQL/grants, policy or Auth settings changed. Requires a separate evaluated remediation PR, disposable DB policy tests, and explicit staging owner approval before moving to production.
