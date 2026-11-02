# VOX TO-00 — Single Admin + Staff account model

**Owner-approved design decision, 15 October 2026. Release HOLD.**

## Exactly two top-level VOX account experiences

1. **ADMIN** = the existing, independently verified **QuickFurno Core owner principal**. There is no separate VOX Owner role, VOX Superadmin identity, generic delegated Administrator user, or parallel Auth user solely because the UI says Admin.
2. **STAFF** = the existing neutral `vox_staff` identity with AAL2 and active Core membership. A Staff user's *responsibilities* may include acquisition, vendor success, support, operations management, Team Leader or auditor, each with separately scoped permissions.

**Team Leader is a Staff capability, not a third top-level account category.** Team Leaders can review and organize their authorized team but cannot activate grants, approve their own access, impersonate Admin, or operate outside their city/team.

### Server authority, not browser labels

- **ADMIN** must be established only from the pre-existing verified Core owner identity and AAL2 path. Existing owner approval, financial, city-control and immutable audit semantics stay unchanged. A staff principal having `staff_role="operations_manager"` is **NOT** Admin.
- **STAFF** must be independently verified using immutable Supabase user ID, neutral app_metadata principal, current Core membership/team/city, object scopes, verified AAL2 and live revocation checks. Profile email, request payload or a client-supplied `role="admin"` value must never grant authority.
- Rendering a shared sidebar/header is fine; enabling action endpoints requires Core to independently re-verify the actor and check specific operation, source object, city/team, revision, consent and approval state.
- Keep separate requester / Team Leader reviewer / Admin final activation actors where existing two-person staff-grant governance requires it. Combining **Owner** and **Admin** *labels* does not erase independent-approval rules.
- Existing GitHub protected staging reviewer is another actual human and cannot be replaced by this UI role decision. Never use owner self-review or an AI pseudo-reviewer.

## Capabilities

| Operation | Admin | Staff | Staff with Team Leader capability |
| --- | --- | --- | --- |
| Multi-city operations dashboard | Core authorized scope | Own authorized objects | Assigned team/city |
| Team / staff directory | All Core-approved teams | Self/own team metadata | Assigned team, least-privilege |
| Invite or change permissions | Request/finalize after separate review | Request own access | Team-scoped independent review, NO activation |
| Claim/assign operational work | Governed Core policy | Only own eligible items | Assign eligible team workload |
| External WhatsApp reply | Core consent/handover/send broker only | Same plus object grant | Same plus team-scoped authority |
| Internal team chat | Permitted discussions | Explicit recipients/cases | Exact-team moderation |
| Daily report | Owner rollups and exceptions | Own EOD submit | Assigned team acknowledgment |
| Financial/vendor activation and AGNI actions | Existing owner-approved Core/AGNI policy | Forbidden | Forbidden |

## Implementation guidance for TO-01...TO-04

- The common `/team` shell may show **Admin** or **Staff**, but must not derive the label from a mutable frontend value. Until Core returns a verified principal class, show only "Authenticated Staff" or "Verified Core Actor" and keep privileged actions disabled.
- The current **TO-01 Core projection** accepts *only staff scoped contexts*, not the owner principal; it is explicitly **not an Admin authorization service**. Build a separate verified owner adapter using pre-existing Core owner guards before the Admin dashboard becomes functional.
- The Admin overview may reuse the same work records and navigation. Do **not** store a second owner profile/membership in VOX staff tables merely for display.
- Keep default-off launch flags, read-only source previews and RELEASE HOLD. No staging SQL, grants, WhatsApp, DNS, GitHub protection or owner credentials are changed by this document.
