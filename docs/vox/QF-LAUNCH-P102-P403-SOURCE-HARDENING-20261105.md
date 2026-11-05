# QuickFurno Launch: P1-02 / P4-03 Source Hardening, 5 Nov 2026

**Source-only security packet. No Staging or Production changes. RELEASE HOLD.**

## Workflow security track (P1-02)

193 workflow files are in the candidate; 162 are newly added relative to protected main. All 162 parsed successfully. The audit of new workflows found no pull_request_target triggers, workflow_run triggers, write-all permissions, or top-level write permissions. Two floating action references were found in the Vendor certification workflow: checkout@v4 and setup-node@v4. Both are now pinned to immutable commit SHA values already used in the integrated release workflow. Four new tests enforce pinned launch-critical actions, read-only permission and no privileged trigger/environment. Two source workflows still run on push; manual dispatch exists for many source checks, so a complete review of permissions, workflow graphs, branch rules and dependencies remains pending. Do not infer independent AppSec approval.

## Seven-migration compatibility track (P4-03)

The exact seven source-pinned November vendor SQL files are unchanged; historical 162 VOX and seven quarantined Staff/TL migration blobs remain unchanged.

The pending atomic signup migration adds uniqueness to existing vendor Auth principals, canonical vendor phones and owner memberships. These can reject migration installation if actual legacy rows conflict. The existing baseline-safe, aggregate-only Staging preflight covers phone duplicates, client/vendor principal collision, legacy owner membership, Pending live flags and historical assignments. It has **not** been executed on managed Staging because its source runbook requires separate Owner approval.

The private verification foundation creates five RLS-enabled private tables, and the scan migration adds a sixth RLS-enabled receipt table. Reviewed new SQL function EXECUTE grants are service-role-only. The assignment verification trigger targets new unverified vendor assignments; actual populated-system behavior, rollback and external provider evidence require protected Staging testing.

Actual QuickFurno Staging read-only catalog: 86 applied migrations, last 20261013144901; zero of seven November versions; private vendor-verification schema and bucket not present. Public ordinary tables 142/142 RLS enabled; 144 public security-definer functions, two callable by authenticated users (is_admin and owns_vendor) and none by anon. Legacy audit_logs has anon SELECT/INSERT grants with authenticated-only RLS policies; review least privilege. Existing vendor-media bucket is **public**, not for private identity proof.

Six new source tests enforce the migration unique-index/preflight boundary, six private table RLS settings, service-role-only functions, assignment-transition preservation and the observed Staging HOLD state.

## Local checks and their meaning

New source tests: 4/4 workflow + 6/6 migration compatibility PASS. Exact source fingerprints and historical delta checks: 8/8 PASS. Original migration G1: 334/334 passed, 153/153 bad mutants rejected. Owner/Core/ClamAV source tests: 17/17 PASS. Real local ClamAV clean/EICAR controls unavailable, so actual scanner certification FAIL CLOSED.

Neither TypeScript success nor green GitHub CI is a substitute for actual signed Staging backup/isolated restore, approved SQL installation, real WhatsApp and Google service certification, private Storage+ClamAV, deployed VOX/Core digests, genuine Owner TOTP AAL2, protected E2E or an independent Production GO.

## Blockers and sequencing

1. Finish inherited workflow, dependency, definer/RLS and protected release review (P1-02).
2. Complete the separately authorized real legacy-data preflight and sign migration/rollback plan (P4-03).
3. Prove actual managed Staging DB/Auth/Storage backup and isolated restore (P4-02).
4. Obtain explicit permission, apply exactly seven reviewed migrations and inspect grants/RLS (P4-04).
5. Certify private Storage/ClamAV, Meta WhatsApp delivery/consent/replay, Google billing/Places and real Owner TOTP AAL2.
6. Complete protected end-to-end and rollback gates, followed by separate Production approval and small invite-only beta.

**Task status: P1-02/P4-03 source subchecks passed; full independent and operational acceptance still pending.** ReleaseDecision=HOLD. Keep Staff frozen, Automation Studio in JARVIS, no cash refunds for bad leads.

Notion: https://app.notion.com/p/40f751ba167c81cdb55bf1ee0c368a2b
