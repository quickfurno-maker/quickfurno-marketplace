# VOX TO-02 — One Staff Identity, Multiple Department Capabilities

**Owner-approved product decision (15 October 2026). Design and pure-contract candidate only; no managed SQL, real invitations, production authority or staff grants. RELEASE HOLD.**

## Roles
- **Admin:** The single existing Core-verified Superadmin / Owner account. Never a selectable staff role or a separate signup account.
- **Staff:** One neutral `vox_staff` Auth profile, one active canonical Core team membership and immutable Auth user ID. This person's permitted departments are explicit and independently approved capabilities.
- **Team Leader:** A bounded privilege for an eligible Staff member within an exact team; not a free-form `departmentPacks` value and not Core Admin.
- **Auditor:** Read-only bounded staff permission, not a department with implicit subject records.

## Capability packs (combinable with one Staff login)
1. `client_success`: Client 360 / Riya. Existing client scoped Core model must first be verified; this pack alone grants no client access.
2. `vendor_success`: Vendor 360 / Anisha.
3. `acquisition`: Aarohi CRM and authorized prospects.
4. `service_support`: Client/vendor Service Desk.

The existing **single** `vox_staff_memberships_v1.staff_role` is NOT silently reinterpreted as a multi-pack list. Do not elevate an `acquisition_agent` via a browser checkbox or forge `operations_manager`. The future Core schema needs independently reviewed `vox_staff_department_capabilities_v1` rows bound to **auth_user_id + team_id + city_id + pack + expiry + reviewed decision**, with audited revoke and versioned read policies. This is a proposed extension, not a migrated table.

**Access intersection:** remote Auth AAL2 verified ∩ neutral active Staff identity ∩ current Core team/city membership ∩ specific active capability ∩ specific Core object scope ∩ current role/function approval ∩ consent/handover (for chat). A pack describes eligible work; it **never grants all client/vendor records**.

## Admin setup interaction
Admin → Team → Add Staff → work email/name and verified city/team → choose one or more department packs → reason and expiry → preview **request, not activation** → independent Team Leader review bound to the same city/team, pack set, target and nonce → Core independently verified Admin finalizes reviewed rights. For a new identity, a separate protected server-only Supabase invitation step first prepares a **neutral staff** principal, with email proof, TOTP and AAL2 before scoped Core grants. No password visible in UI. Signed review references must bind exact target and packs; no self-review and no Team Leader account activation.

Admin may later request add/remove packs, team transfers or emergency revoke. Removal/transfer must invalidate old grants, current streams, queue subscriptions and in-flight writes. A Staff member may receive multiple pack-specific queues on the same My Work page; their daily report is consolidated across packs.

## Code in this draft
- `contracts/vox/staffDepartmentPacks.mjs` pure, fail-closed request planner and privacy-limited preview of independently activated Core records.
- `scripts/mvp/vox/validate-to02-multi-department.test.mjs` negative identity, privilege escalation, city/team, expiry, actor/reviewer and pack-boundary regression cases.
- No service role calls, account creation, invitation email, mutation API, approval bypass, external message sends, Core schema migration, or staging enablement.

## Next protected engineering gates
1. Review existing membership/RLS schema and source-authoritative Core identity/Team Leader review functions, design department grant table with server-owned authority and atomic independent approval.
2. Extend `getVerifiedScopedStaff` only **after** role-compatible changes are proven in isolated PostgreSQL; no unverified client JSON grants.
3. Add Core read-only Admin directory and capability catalogue plus VOX Admin create-staff preview with all buttons gated. Then implement audited request→review→activate through existing Core pattern, not direct Supabase writes from Web.
4. Only later allow real server-owned Auth Admin invitation and real stage AAL2/email; genuine provider sends and Cloudflare changes remain unauthorized.
5. Test concurrent edits, duplicate request replay, TL conflict, cross-team and cross-city IDOR, immutable subject grants and immediate revocation with signed audit.

**Proof of completion for TO-02:** isolated PG17 atomic-grant tests, Web AAL2 + Core E2E, live synthetic staff, independent DBA/security review, signed staging artifact and rollback. Pure-source CI is NOT proof of deployment.
