# VOX AB-4 Staff invitation evidence gateway — RELEASE HOLD

**Source implemented:** `POST /api/vox/v1/ab4-staff-review`, new `ab4StaffRequestGateway.mjs` with exact browser request-shape validation. Current Superadmin verified via remote Supabase Auth AAL2 + Core profile; reviewer receives separate current Core-neutral Team Leader AAL2 via `getVerifiedScopedStaff`. Normal request creates **ONLY** an immutable candidate SQL pending review record, independent TL decision creates **ONLY** a separate review record. Candidate tables are from previous AB-3 under `ops/vox/sql-candidates`, NOT installed in managed staging.

Default OFF unless `VOX_AB4_STAFF_REVIEW_ENABLED=staging` with existing Core grants/department flags. Replays/duplicate nonces, self-review, stale members and invalid department packs fail at SQL candidate. No plain email/personal data accepted (SHA256 digest only); **SHA256 is NOT identity verification nor a cryptographic reviewer signature**. This route **NEVER** creates an Auth account, sends an invitation or grants any department; actual Staff lifecycle is still incomplete.

4/4 focused tests passed, full Core VOX suite 364/364 locally, Core typecheck and full CI release-hold checks required on exact SHA. Default disabled HTTP GET 405, POST 503, and no public route promotion. No human reviewer authorization implied.
