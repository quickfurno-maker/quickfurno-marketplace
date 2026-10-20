# Cursor — VOX RC1 Phase 1 independent technical audit assignment

**Open source checkout:** `D:\QuickFurno-Workspace\Worktrees\qf-voxRC1-final-integrated-20261020`
**Exact source:** `238fcb943cbdf7e2952592f813dd6a615df3c107`, [Core PR #383](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/383).
**Review instructions:** `D:\QuickFurno-Workspace\Worktrees\qf-voxP1-audit-20261020\docs\vox\VOX-PHASE1-DBA-APPSEC-CURSOR-REVIEW-20261020.md`
**Current Staging:** zero VOX tables, one real Superadmin Auth user, zero MFA; NO managed DB changes permitted.

Cursor: read the detailed technical audit assignment above, inspect all 30 ordered candidate SQL files and the critical VOX/Staff/agent/auth/worker routes, provide findings with exact file/line, severity and safe remediation. Independently check current source permissions, reviewer signatures, RLS, read revocation, JWT/session freshness, task replay/idempotency, tenant/city scoping, release manifest, and rollback. Specifically review a publicly selectable definer view `vendor_public_v`, the two authenticated-callable SECURITY DEFINER RPCs `is_admin` and `owns_vendor`, and 102 RLS-enabled/no-policy advisory findings for intentional deny-all vs hidden bypass. Assess the staged Owner TOTP enrollment candidate in `qf-voxP1-identity-20261020` against Supabase Auth TOTP APIs. Do not run SQL against live staging or production, alter secrets/keys, enroll MFA, provision a Team Leader, send WhatsApp, merge PRs or deploy.

Write a report to `D:\QuickFurno-Workspace\VOX-review\VOX-RC1-CURSOR-TECHNICAL-AUDIT-20261020.md` with explicit PASS/FAIL/UNVERIFIED for each area, reproduction steps and test commands. End with **TECHNICAL REVIEW ONLY, NOT AN AUTHORIZED INDEPENDENT HUMAN SIGN-OFF; RELEASE HOLD**. If you cannot execute analysis, mark review NOT PERFORMED rather than guessing.
