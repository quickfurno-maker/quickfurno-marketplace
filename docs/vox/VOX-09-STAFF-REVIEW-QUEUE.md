# VOX-09 — Team Leader read-only pending approval queue

The pending access-review queue lives in **existing Core staff-review tables**, not a second admin/approval store. Core GET `/api/vox/v1/staff-review-queue` requires the default-disabled `VOX_STAFF_GRANTS_ENABLED=staging` flag and a fresh Supabase Auth AAL2-backed VOX team_leader membership with active Core team/city. It returns only PENDING, revision-zero requests for that exact team, excludes requester and target self-review and hard-limits 16 entries. Email, phone, raw metadata and other teams are not exposed.

The route is read-only, all mutation methods 405. Actual review (a separate existing Core `POST /api/vox/v1/staff-grants` action) validates request ownership, reviewer role, active same team, expected revision and immutable audit atomically. No direct grant/activation is possible here.

Status: source-only; neither migration nor role provisioning is installed on Supabase Staging. No Team Leader email invitation or Supabase account creation. The user can replace the nominated email later without touching the immutable internal principal ID.
