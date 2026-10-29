# VOX Owner navigation and Core deployment audit — 29 October 2026

## Scope and evidence
- Reported symptom: Owner successfully authenticates at VOX Operations but Vendor 360 / Acquisition / Service Desk and other nav items show an unavailability gate.
- Verified current VOX web runtime had `VOX_STAFF_PORTAL_ENABLED=staging`, `VOX_STAFF_VIEW_MODE=owner`, `VOX_STAFF_MFA_ENROLL_ENABLED=disabled`, Cloudflare Access required, and pinned HTTPS Staging Core.
- The dashboard successfully displayed 4 bounded records from the authenticated Owner overview, proving that at least the owner read path works.
- Read-only no-token Core probes: `/api/vox/v1/overview` -> 401 (protected, deployed); `/vendor360`, `/acquisition`, `/desk`, `/aos-health`, `/studio-simulate`, `/staff-review-queue`, `/action-intents`, `/my-work`, `/vendor-task`, `/execute-followup` -> 404 (missing from deployed Core Staging). No Auth token was sent.
- Original scoped pages reject `owner` view mode by design. Their full surfaces require independently authorized staff assignments, Core routes, feature flags and QA.

## Source correction (UI-only, no privilege expansion)
1. Reuse the already-authenticated, bounded `fetchStaffOverview()` Core read projection for dedicated **Owner previews** on `/acquisition`, `/vendor360` and `/service-desk`. Maximum eight rows per projection, only fields already allowed in Owner Overview. These are not the full staff experiences.
2. Keep existing staff-scoped codepaths unchanged when `VOX_STAFF_VIEW_MODE` is not `owner`. Deny/hold on owner read failure.
3. On the Owner command-center nav, label usable destinations as previews and render undeployed/uncertified pages (Intelligence, Automation Studio, Staff Reviews, Owner Approvals) as visibly locked, not misleading live links.
4. Replace owner quick-action links with certified previews only. Retain the pre-existing literal Studio link under non-Owner branch to satisfy legacy source-contract QA.
5. Restore legacy shared `.voxOps/.voxUnit/.voxRow/.voxHero/.voxNotice` styling required by existing workspaces. Improve fail-closed `.hold` state and mobile navigation instead of hiding all navigation below 820 px.
6. Add fail-closed Owner navigation regression covering 10 assertions to the standard VOX `npm test`.

## Certification boundary and pending work
- Do not change `VOX_STAFF_VIEW_MODE` to `dual` merely to make the links work: no eligible Team Leader/team/zone grants or live scoped Core endpoint were verified.
- Do not expose raw database vendor profiles or add direct Supabase reads from VOX to replace missing Core endpoints.
- Do not enable `VOX_STUDIO_WEB_ENABLED`, `VOX_OPERATIONAL_REVIEW_UI_ENABLED`, `VOX_INTELLIGENCE_VIEW_ENABLED`, `VOX_STAFF_REVIEW_WEB_ENABLED` or any provider actions until their own Core deployment and authorization/QA gates pass.
- Full VOX capability is **NOT** deployed or certified. Core Staging currently exposes only the minimum Owner read endpoint. Production remains HOLD.
- Separately pending: reviewed P0-6 `is_admin() AND is_active IS TRUE` *new* Staging migration + real auth/policy regression; protected VOX Core endpoint rollout; first Team Leader bootstrap and scoped assignment; independent AppSec/DBA review; Production cleanup and marketplace go/no-go.
- Exact next engineering step after Owner preview rollout: stage and certify a **read-only Core functional endpoint batch** (Aarohi CRM, Vendor 360, Service Desk) with active AAL2 + exact team/zone grants and deny tests; only then enable scoped staff mode and the corresponding UI gates. In parallel finish the separately approved P0-6 database Staging gate. Keep outbound actions, payment changes, real marketplace activation and Production untouched until approvals.
