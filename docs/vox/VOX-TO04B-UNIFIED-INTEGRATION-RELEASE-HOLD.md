# VOX TO-04B unified integration candidate — source-only release HOLD

Owner goal: one existing Core Superadmin identity (sole Admin), one existing Supabase Auth neutral Staff login per employee; separate independently reviewed department grants; Team Leader is restricted Staff, not Admin. No second authentication system.

## Consolidated candidate (unmerged GitHub draft #285)
- **Canonical grant candidate B, not reviewer-approved**: original #269/#270/#272/#274/#279/#284, with bound requesting owner on activation. Do NOT import alternate candidate A #267/#268. Technical source integration is not independent human security approval.
- Core Staff reader reuses live Supabase AAL2 Auth, neutral principal, current team/city, exact object scope AND reviewed current department/reviewer; revoking reviewer, Staff or pack rejects reads.
- One Core work-item candidate (#275/#278), nondeployable SQL, 2/10/50 synthetic PG17 claims; no client/Riya work actions, no provider sends, no lead matching changes.
- Core read-only Staff work queue (#282) reuses verified department reader, subject-specific city checks, bounded metadata. New VOX Web `/team/work-queue` uses existing verifiedMfaSession backend proxy, no browser direct Core bearer or service_role, strict response schema, inaccessible action buttons.
- Owner Admin Staff setup (#277) reads bounded Core active team-city pairs but never invites staff or executes grants.
- Riya (#280) non-executable handover/consent intent. Anisha/Aarohi inbox metadata (#276), and EOD reports (#276/#283) remain read-only, watermark-incomplete until real Core/Jarvis evidence verified.
- TO-04A HOLD manifest, independently attested initial TL runbook and branch source guards imported (#281). No migrations in managed supabase/migrations.

## Manual independent pre-merge security and schema gates
1. Human security reviewer compares Candidate A/B for full feature invariants, chooses exactly ONE and reviews final SQL/RPC under original complete PostgreSQL schema, required unique constraints and RLS. Verify no route duplicates.
2. DBA verifies original 86 historical Staging migrations, offline dump checksum and isolated restore, runnable migration and verified rollback. All unreviewed SQL remains outside managed Supabase migrations until explicit approval.
3. Independent human first Team Leader bootstrap attestation from neither sole Superadmin nor candidate; genuine AAL2/TOTP, exact Staff UUID/team/city, one-use nonce, audit+revoke. No fabricated reviewer or bypass.
4. Synthetic live Supabase Auth Core HTTP E2E: owner/Admin, independent TL, one staff multi-pack, AAL1 denied, wrong role/subject/city IDOR, expiry/nonce/concurrency/revocation/session SSE, first bootstrap rollback.
5. Real JARVIS Riya/Anisha/Aarohi and AGNI staging wiring, signed pause/human consent/opt-out/cross-channel memory deletion and idempotent provider outbox. No outbound sends until separate approval.
6. Protected human staging reviewer, signed exact OCI SHA, private ingress, dependency canaries, full rollback rehearsal and explicit owner promotion authorization. Test staff access disabled after rollback.

## QA semantics
All per-PR and combined CI pass only source/build/synthetic checks. They do NOT imply 86-migration recovery, a genuine human signature, staging AAL2, actual Jarvis/WhatsApp integration, or production readiness. This candidate remains DRAFT, all flags OFF, no invites, no SQL migration, no deploy and no messages.
