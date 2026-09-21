# QuickFurno security operations

These scripts capture production hardening that intentionally does not add a
business-schema migration.

- qf-production-audit-hardening-20260921.sql removes unnecessary browser
  EXECUTE grants from SECURITY DEFINER trigger functions and drops known
  duplicate indexes if still present. Authenticated execution of is_admin()
  and owns_vendor(uuid) is intentionally retained because active RLS policies
  use those helpers.
- qf-production-rpc-hardening-20260921.sql removes browser RPC execution from
  additional internal trigger/event-trigger helpers when present.
- qf-production-rls-initplan-optimization-20260921.sql preserves RLS semantics
  while making auth.uid() an init-plan scalar for seven hot policies.
- qf-jarvis-schema-rls-hardening-20260921.sql enables RLS on the private
  qf_jarvis tables while preserving their existing no-browser-access posture.

public.vendor_public_v intentionally remains an owner-rights allowlisted public
projection over the private vendors table. Converting it mechanically to a
security-invoker view would either break anonymous discovery or require broader
base-table privileges, so that advisor finding is accepted until a separate
public-projection storage redesign is explicitly approved.

The authenticated SECURITY DEFINER warnings for public.is_admin() and
public.owns_vendor(uuid) are also intentional RLS-helper authority. Their anon
EXECUTE grants are revoked; authenticated execution is required by current
policies.

Hosted Supabase Auth settings such as leaked-password protection and Auth DB
connection allocation are management-plane settings and are not changed by SQL.
