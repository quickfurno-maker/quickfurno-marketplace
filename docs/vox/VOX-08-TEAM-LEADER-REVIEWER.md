# VOX-08 — Team Leader, restricted staff-access reviewer (source-only)

Business designation: the Team Leader contact is recorded in the restricted operations tracker, **not** committed to source control. This is an **invitation/verification target, not an activated account**. Never bind permissions to the email literal: bind to immutable Supabase Auth `users.id` after control of the address is confirmed and owner authorizes role activation. Changing the email later should preserve the internal user ID and audit history; replacing the individual requires full revocation and fresh verified identity.

The previous Core VOX staff-grant code was Superadmin-only for both approval and activation. VOX-08 corrects the authority split without elevating the Team Leader to Superadmin:

- **Owner Superadmin (requestor):** opens a request using a server-verified AAL2 identity; still cannot review that request.
- **Team Leader (independent reviewer):** `app_metadata.vox_role=team_leader` plus active, nonexpired Core `vox_staff_memberships_v1.staff_role=team_leader` for the request's exact team, active Core profile. Verifies the team and refuses own approvals, owner bypass and manager/auditor escalations. Never sees arbitrary vendor/prospect records or message content merely from this role.
- **Owner Superadmin (finalizer):** separately verifies AAL2 and only activates a Team-Leader-reviewed grant with matching immutable decision receipt; rechecks that Team Leader is still active at finalization and same team. The owner cannot approve their own request, and cannot bypass a distinct reviewer.
- Existing Core emergency revocation still belongs only to Superadmin and is separately audited.

New source migration `20261014050000_vox_v1_team_leader_review_policy.sql` extends the internal staff role constraint and replaces the existing review/finalizer functions with the Team-Leader-specific authorization split. This is **not applied** in Staging or production. No invitation email, password, OTP, privileged user, email change or Supabase Auth metadata has been created/changed.

**Isolated PostgreSQL 17:** five dependency migrations plus synthetic identities passed Owner request → distinct Team Leader review → Owner finalizer, escalation rejection, Superadmin reviewer bypass rejection and revoked Team Leader rejection. Marker: `VOX08_TEAM_LEADER_PG17_PASS owner_request=1 team_leader_review=1 owner_activation=1 escalation_denied=true owner_bypass_denied=true revoked_reviewer_denied=true`. A seeded Team Leader is synthetic only.

**Pending before real activation:** independently confirm the designated email belongs to an authorized Team Leader, provision a separate Supabase account, enforce email confirmation/TOTP AAL2, issue *explicitly approved team-scoped Team Leader attestation* in Core, test real positive/negative HTTP and run migrations after reviewed Staging backup+restore. Do not manually grant Superadmin or auto-bootstrap a Team Leader; no private staging rollout or public VOX DNS activation yet.
