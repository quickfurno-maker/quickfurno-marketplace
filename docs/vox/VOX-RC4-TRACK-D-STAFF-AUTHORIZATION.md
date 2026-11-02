# VOX RC4 Track D: Verified Staff Authorization Binder

Date: 2026-10-30. Base: `f5dd7e48` (PR #446, DRAFT). Source-only; nothing was executed.

## Status

- **Tests were NOT run.** This session had no shell. Traced by hand only.
- No release, activation, migration, user creation, RLS change, network or credential use.
- Feature gate `VOX_RC4_STAFF_AUTHZ_ENABLED` is hard-off (needs the exact value `staging`), and the adapter's session probe returns `false` unconditionally, so it denies even if the flag is set.

## Audit of existing code (read-only)

| File | Finding |
|---|---|
| `services/vox/verifiedStaffBearer.ts` | Owner-only. Auth `getUser` + `aal==="aal2"` + `profiles.role==="admin"` + `app_metadata.admin_role==="Superadmin"`. No session-liveness or revocation-epoch check. |
| `services/vox/verifiedScopedStaff.ts` | Neutral staff. Same Auth/AAL2 check, then `isNeutralVoxStaffPrincipal`, membership, team, city. Does not read `vox_role`, requires no `session_id`, and has no same-JWT revocation beyond DB freshness at call time. |
| `contracts/vox/neutralStaffPrincipal.mjs` | `profile.role===null`, active, `qf_principal==="vox_staff"`, `admin_role==null`. Reused as the rule. |
| Staging reality | 1 MFA principal, 0 VOX Staff tables. The binder's Staff path therefore has nothing to read yet; every Staff request must deny. |

## Files (all new)

- `lib/vox/rc4StaffAuthorization.mjs`: pure binder `authorizeRc4Staff`, `parseBearer`, `RC4_STAFF_DENIALS`.
- `lib/vox/rc4StaffServerAdapter.ts`: `requireRc4Staff`, read-only Supabase wiring (hard-off).
- `scripts/mvp/vox/rc4-staff-authorization.test.mjs`: node:test suite.
- This doc.

No shared auth file was modified.

## Contract

`authorizeRc4Staff({authorization, required, claimedUserId?, teamId?, cityId?, approval?, deps})`
returns a frozen `{ok:true, principal}` or `{ok:false, code, status}`.

`principal`: `{kind:"owner"|"team_leader"|"staff", userId, sessionId, staffRole?, teamId?, cityId?}`

Codes to status: BAD_REQUEST 400; UNAUTHENTICATED, AAL2_REQUIRED, STALE_CREDENTIAL, SESSION_REVOKED 401; SUBJECT_MISMATCH, PRINCIPAL_MISMATCH, NOT_STAFF, MEMBERSHIP_INACTIVE, ROLE_MISMATCH, SCOPE_MISMATCH, SCOPE_REQUIRED, SELF_APPROVAL, OWNER_STAFF_CONFLATION 403; DEPENDENCY_UNAVAILABLE 503 (any thrown dependency). Surface only `status` to clients.

Rules enforced:
1. User id comes from remote Auth `getUser`; token `sub` must equal it. `claimedUserId` is compared and rejected on mismatch (IDOR), never used.
2. `aal` must be exactly `"aal2"`; `exp`/`iat` bounded; `session_id` UUID required; anonymous denied.
3. Same-JWT revocation: `isSessionLive(user, session_id)` must be exactly `true`, and `iat` must not predate `authorizationEpoch` (undefined fails closed).
4. Staff requires `is_active===true` (null/false/undefined denied), `revoked_at===null`, mandatory live `expires_at`, active team and city, team to city consistency, and a named team/city that equals the membership scope.
5. Owner and neutral Team Leader are disjoint. Owner with any membership is denied. A Team Leader needs `qf_principal=vox_staff`, no `admin_role`, `profile.role===null`, and `vox_role` and `staff_role` agreeing on `team_leader`.
6. `approval` denies when the approver is the requester or the target, and only Team Leader/Owner may approve.

## Integration points (route handlers, for the owning track)

```ts
import {requireRc4Staff} from "@/lib/vox/rc4StaffServerAdapter";
const r = await requireRc4Staff({authorization: req.headers.get("authorization"),
  required: "team_leader", teamId, cityId, approval: {requestedBy, targetUserId}});
if (!r.ok) return new Response(null, {status: r.status});
// use r.principal.userId, never a body-supplied id
```

Do not replace `verifyVoxOwnerBearer` / `getVerifiedScopedStaff` callers in this track.

## Tests to run (human or CI)

`node --test scripts/mvp/vox/rc4-staff-authorization.test.mjs`

Covers: IDOR, wrong JWT subject, no MFA (aal1/missing/null), active false/null/missing, revoked/expired membership, wrong team/city, inactive team/city, self-approval, non-leader approval, Owner/TL separation and conflation, stale revocation, dependency failure, purity and hard-off source checks. Also run `npm run build` to type-check the adapter, which has never been compiled.

## Open blockers

1. **Session revocation probe**: `auth.sessions` is not reachable via PostgREST. A reviewed read-only SECURITY DEFINER function (or Auth admin API) is needed before `isSessionLive` can return `true`. This is a DB change for the DB track, not done here.
2. **Authorization epoch**: no reviewed source exists, so `loadFacts` returns `undefined` (fail closed). Needs a trustworthy "last role/membership change" timestamp.
3. **Schema absent**: `vox_staff_memberships_v1` / `vox_staff_teams_v1` do not exist on staging. Migration approval and SHA/DBA review stay with their tracks.
4. **Human enrollment**: genuine Owner and first Team Leader enrollment (MFA, `qf_principal`, `vox_role` app_metadata) is a human action. No user creation here.
5. **Unverified assumptions**: the adapter relies on `vox_role` being set in `app_metadata` for Team Leaders, as the existing reviewer path does. Confirm with the enrollment procedure. TS type of `.mjs` import is untested.
