# VOX Phase A — Invitation and MFA recovery governance (RELEASE HOLD)

Only a **neutral Core profile** with `profiles.role IS NULL` and trusted Supabase server-set `app_metadata.qf_principal=vox_staff`, with no `admin_role`, is eligible for ordinary staff onboarding. Core Superadmin remains a separate administrative identity. Do not use mutable user metadata as authority.

## Safely prepared in source

- `contracts/vox/staffBootstrapGovernance.mjs` enforces a distinct verified AAL2 Core Superadmin and Team Leader reviewer in the exact Core team, signed/revalidated owner and reviewer evidence, valid role, bounded invitation lease, canonical email and nonce. **This is a pure preparation decision** and cannot create accounts or send invitations.
- MFA factor recovery requires independent reviewed incident, neutral staff identity, revoked Core membership **and all object scopes**, invalidated sessions and audit evidence *before* further consideration. It deliberately never un-enrolls the factor or activates a staff account. A future managed operator step must safely enforce Auth sessions and factor revocation and be separately certified.
- The test harness exercises malicious role/city/team/email/nonce/lease/identity/recovery transitions. No genuine Supabase Auth identity is generated.

## Authorized operator-only next steps (not performed here)

1. After #246 genuine staging restore and #254 security signoff, provision staff through a **trusted server-only** Supabase Auth Admin path, never browser/service-role credentials. Ensure app metadata is authoritative **before a usable invitation**, and confirm email and MFA are enforced. The Auth Admin `inviteUserByEmail` can send mail, so it MUST NOT be called by this source-only gate. A return of an invite call does not guarantee its separate app-metadata update was atomic.
2. Verify invite was independently approved, Core team city active and profile still neutral. Prove no legacy Core `is_admin()` grants for the staff principal.
3. Activate membership through the existing independently reviewed owner Core finalizer, with expiry and assigned object scope. Do not directly edit VOX grants in Supabase dashboard.
4. For MFA recovery, revoke all Core permissions, revoke/expire server sessions and audit, and require a distinct owner+reviewer incident. Use documented Supabase factors APIs from a privileged server under human approval and force full fresh email verification and fresh TOTP/AAL2 before new approval. Never simply suppress the MFA requirement or restore an old membership.
5. Verify account disabled after emergency revoke, token refresh, old access JWT, cross-city IDOR, duplicate invite, factor reset, session revocation and audit persistence.

## Hard stops

Feature flags and releases remain OFF. Source tests do not verify live Auth admin operations, session invalidation, recovery or owner approval. Separate protected staging and production go/no-go remain mandatory. This document and contract are not an operational authorization to invite any real staff.
