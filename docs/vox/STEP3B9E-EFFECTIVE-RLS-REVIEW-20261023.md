# 3B-9E — Effective Supabase RLS permission-composition review (source plan, **not certified**)

Managed Staging SELECT-only 23-Oct-2026: **69 affected named policies across 40 public tables**, including **37 write/ALL** and 32 SELECT. **53 affected policies sit on tables with more than one overall policy**; 0 affected policies sit on a table with a restrictive policy in the observed catalog. Multiple permissive policies can combine through OR; this is NOT an effective RLS certification. Other table policies, grants, view security modes, SECURITY DEFINER functions and context roles must be evaluated together.

The helpers `public.is_admin()` and `public.owns_vendor(uuid)` are both SECURITY DEFINER; live role privileges allow `authenticated` EXECUTE, but not `anon`. `is_admin()` lacks active Admin-profile gating; `owns_vendor(uuid)` lacks suspended vendor gating. Existing review-only SQL candidates must NOT be deployed or altered globally without confirming historical read requirements and cross-policy composed effects. Review `vendor_public_v` discovery semantics separately.

## Reviewer tasks
- Examine `ops/vox/certification/STEP3B9E-EFFECTIVE-RLS-REVIEW-20261023.json`: every one of the 69 policies is individually mapped to its table, command, source-expression hash and required positive/negative scenarios. All actual simulated managed-session test flags are false.
- Independently retrieve **all** policies and grants per affected table, not only the 69-helper subset. Evaluate all permissive OR and restrictive AND paths, SELECT/UPDATE/INSERT/DELETE/ALL, `USING` and `WITH CHECK`, function grants, role inheritance, security-definer views, JWT session freshness, RLS bypass paths.
- Test inactive Admin, revoked Staff department/team grant, suspended vendor denial for new-work/write/dispatch/send, different-vendor tenant isolation, permitted historical invoice/refund/dispute read by scoped actors and authenticated Owner AAL2.
- Resolve the 37 write/ALL cases first; later 32 SELECT policies still require confidentiality analysis. Denied access on one policy does not imply deny on the table if another permissive policy grants access.
- Record exact SQL diffs and signed independent AppSec/domain-owner decisions for all 69, plus genuine disposable-Postgres17 and managed Staging SQL tests after independent authorization. Never use a service-role bypass as proof of ordinary Staff/Authenticated effective access.

**NOT an effective RLS certification. No managed table/permission, session or Auth operations were performed. Reviewer: not yet assigned. Gate: HOLD.**
