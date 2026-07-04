-- ============================================================================
-- QuickFurno — 20260704000110_lead_scores_security_hardening.sql
--
-- Security hardening for public.lead_scores (created by
-- 20260702000038_lead_quality_engine_phase1.sql). ADDITIVE ONLY — enables RLS,
-- strips broad default API-role table grants, and explicitly re-grants the
-- service-role access the app actually needs. No data is read/updated/deleted;
-- no columns, constraints, or indexes are changed. Idempotent + safe to re-run.
--
-- WHY THIS IS NEEDED
--   lead_scores holds INTERNAL lead-quality scoring (contact/location/requirement/
--   intent sub-scores, fraud penalty, total score, hard-block reason, recommended
--   action, full score breakdown). It must NOT be exposed to the public PostgREST
--   API. On this project the public schema was created with broad default table
--   privileges for the API roles (anon / authenticated), and every other sensitive
--   lead table (leads, lead_assignments, lead_status_updates, bad_lead_reports,
--   whatsapp_logs, lead_timeline_events, …) already runs under RLS
--   (20260620000002_rls_policies.sql). lead_scores was created WITHOUT RLS, so it
--   is currently the odd one out — potentially world-readable via the anon/auth
--   keys. This migration brings it in line with the rest of the schema.
--
-- ACCESS MODEL (audited against the repository)
--   Only runtime accessor: services/leadQualityService.ts (scoreAndStoreLead),
--   which uses adminClient() (service_role) to INSERT a score row per lead, and
--   may read internal scoring data where required. There is NO browser-side
--   (anon/authenticated) read or write of lead_scores anywhere in the app
--   (the CRM "Breakdown" cell is a static TODO string, not a query). Therefore:
--     • anon / authenticated  → NO access (RLS deny-all + revoked table grants)
--     • service_role          → SELECT + INSERT (bypasses RLS in Supabase)
--   No UPDATE/DELETE is granted (the app never updates/deletes score rows; the
--   leads→lead_scores ON DELETE CASCADE runs as a referential action and does not
--   require a DELETE grant on the child table).
-- ============================================================================

-- 1) Enable RLS. With no policies for anon/authenticated, this is deny-all for
--    the API roles — matching every other sensitive lead table in the schema.
alter table public.lead_scores enable row level security;

-- 2) Defense in depth: revoke any broad default table privileges the project may
--    have granted to the PostgREST-exposed API roles. RLS already denies them,
--    but revoking the grants closes the door even if a policy is ever added.
revoke all on public.lead_scores from anon;
revoke all on public.lead_scores from authenticated;

-- 3) Explicitly grant the service-role the access the app requires. service_role
--    bypasses RLS, so no policy is needed (consistent with the rest of the repo,
--    which defines policies only for anon/authenticated). We keep it least-
--    privilege: exactly the SELECT + INSERT the scoring service performs.
grant select, insert on public.lead_scores to service_role;

-- Deliberately NOT created (per security review):
--   • no anon policy / grant
--   • no authenticated read policy — no legitimate browser-side requirement exists
--   • no UPDATE / DELETE grant to service_role
