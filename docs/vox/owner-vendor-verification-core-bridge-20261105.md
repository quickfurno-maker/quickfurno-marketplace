# VOX Owner Vendor Verification — verified Core route integration (source-only)

**Date:** 2026-11-05. **Release:** HOLD. This isolated combined code candidate contains the **original**, unmodified Core Owner verification route handlers from protected [Vendor Draft PR #484](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/484) at `b177f5289a10a0736e5ddd5e206304eb49e44ba1`, alongside native VOX Owner Web [Draft PR #485](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/485) at `7aad22ffcf55e163d534331997d5b11c474e678a`.

## Actual code boundaries

- VOX Web `/owner/vendors/verification` with `GET /api/owner/vendor-verification/queue`, case GET, and strict Origin-bound POST decisions (VOX AAL2/session, bounded JSON; no browser-to-Core bearer).
- **Newly included genuine Core routes:** `app/api/vox/v1/owner-vendor-verification-queue/route.ts` and `app/api/vox/v1/owner-vendor-verification-case/route.ts`. Both recheck true signed Owner Superadmin AAL2 before replying/committing. They return sanitized case statuses; no private document bytes, Aadhaar, PAN, storage URLs, direct vendor activation, credits or lead assignments.
- The Core queue route requires **both** `VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED=staging` and `VOX_OWNER_VENDOR_QUEUE_ENABLED=staging`. Core case GET/POST requires `VOX_OWNER_VENDOR_CASE_REVIEW_ENABLED=staging`. VOX UI read and write gates are independent (`VOX_OWNER_VENDOR_REVIEW_ENABLED=staging` and `VOX_OWNER_VENDOR_DECISION_ENABLED=staging`). All defaults remain OFF.
- Staging Core origin is pinned to `https://staging-core.quickfurno.in` on the VOX Web server. No arbitrary Core proxy. Staff, Team Leader, and Jarvis Automation Studio remain untouched.

## Hard dependency — not installed by this candidate

This branch deliberately **does not introduce the seven new vendor verification SQL migrations into the legacy VOX release train**. They are separately pinned and tested in Draft PR #484, including immutable consent, one atomic Pending signup, private evidence, Owner review CAS, scanner receipt/quarantine and service-role-only queue/snapshot.

Their source versions are `20261104090000`, `20261104140000`, `20261104153000`, `20261104160000`, `20261104163000`, `20261104170000`, `20261104173000`. The two Core routes cannot complete positive DB requests until the exact independently reviewed Staging migration plan has been approved, installed, and read-back verified. Missing RPC, table, bucket or approved Owner MFA must fail closed (503/403). **Do not enable either Web or Core review flag solely because this source builds.**

A dry-run attempt to merge every PR #484 migration into the historical VOX release train produced 11 genuine governance failures (RC22–RC40 immutable snapshot/digest checks, VOX migration quarantine and 162-versus-169 managed inventory). This branch preserves those gates and contains **only the two necessary Core API handlers** plus generated Phase21/Phase22 callsite inventories. Never edit historical migration truth to make new SQL appear already applied.

## Before controlled Staging (requires separate Owner approval)

1. Review a **real, read-only Staging baseline inventory** and reconcile legacy vendor/matching compatibility, previous vendor identity owners and pending active flags.
2. Obtain and verify exact seven-source migration hashes, DBA/owner-reviewed migration order and real rollback/restore evidence. Approve Staging private bucket ACL/retention and authentic malware scanner EICAR/signature test.
3. Reconcile the actually deployed `vox.quickfurno.in` Owner image/digest and preserve its verified Cloudflare Access → VOX login → TOTP AAL2 flow.
4. Confirm secure Core/VOX image pair includes this adapter and all required RPCs with genuine Owner MFA positive and negative UAT. Enable **read-only first**, independently verify private Core queue projection; decision flag remains OFF until later approval.
5. Keep Production, onboarding live admission, lead delivery/credits, bad-lead money refunds (not permitted), provider messaging, Staff functions, Finance writes, and official EOD on HOLD.

Source-only local RC4 passing is **not** Staging UAT or permission to deploy.
