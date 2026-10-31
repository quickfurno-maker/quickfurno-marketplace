# VOX — Final Integrated Launch Candidate and Remaining Acceptance Gates
**2026-10-30 · unified candidate, protected DRAFT · no managed database mutation · no Production GO**

## What changed in this consolidation

The long-lived VOX source stack (AB7K RC2–RC5, ending at `7eff3d9ea6c36fb0afbf1b4902edcac3424f196d`) had diverged from `origin/main`, while the accepted inactive-admin security fix from PR #443 was in `main`, absent from the VOX ancestry. A separate authorized worktree `feat/vox-rc6-operational-20261030` merged **current origin/main `b9f8ada90283704c1841d4cd2572305550bca440`** into the VOX source. Exactly **13 conflicts** were resolved by choosing the newer main versions of 12 explicitly guarded VOX API route files and one genuine auth harness, not by removing authorization requirements. All merged files were staged, checked, and committed. The security merge SHA is **`e3bfc317175f062e65b2b93cdd9e6b8ae29e1122`**, with `b9f8ada9` confirmed as an ancestor. The user Active checkout and its unrelated changes were preserved.

## Evidence executed on JARVIS from that exact merged tree

| Acceptance area | Executed outcome | Scope |
|---|---|---|
| TypeScript and Next.js 16.4.1 production compile | **PASS** | actual integrated source |
| Main admin active/inactive/null guard suite | **8/8 PASS** | source guards from previously accepted PR #443 |
| Genuine local GoTrue/Auth/PG/PostgREST VOX Owner overview | **8/8 PASS** | real local TOTP MFA, AAL1 denied, AAL2 admitted, invalid/expired/revoked denied; no managed service |
| Genuine local GoTrue + SSR Next HTTP Core admin session | **19/19 PASS** | real signed/expired/revoked? session checks, active=false/NULL immediate revocation; local only |
| 7 quarantined + 23 VOX SQL candidates | **30/30 installation PASS** | isolated PG17; 39 tables RLS enabled + forced, no direct browser DML, pre-VOX restore rehearsal |
| AB7B native CRM/Support atomic writer | **PASS** | network-isolated PG17, replay/forged actor/immutable row denied, CORE_CONVERSATION hard-off |
| Internal VOX regression | **161/161 PASS** | source/read/identity/gate contracts |
| RC4–RC5 focused authorization/security suites | **95/95 PASS** | source/negative cases |
| Consolidated source-only orchestrator | **104 suites / 714/714 PASS** | `SOURCE_PASS` / `releaseDecision=HOLD`, report checksum `6a399f7691fe36dd32df187bd8b974cf6ded403f159b9d1e8d31f803e15123a4`; full PG17 and real auth were separately executed, not counted as positive orchestrator steps |

All real HTTP and PostgreSQL activity above was confined to disposable local test infrastructure. No keys or real account tokens were uploaded to GitHub or Notion. These tests **do not prove** that an uninstalled Staff schema operates in actual managed Staging or Production.

## Genuine unfinished features — do not re-label as completed

1. **CORE_CONVERSATION source writer:** source contract now re-checks canonical consent while holding transaction locks, but the actual D2-C/D2-D Core consent writer and Staff city/team/role same-destination database serialization have not been integrated with a reviewed Postgres writer. The AB7B SQL CHECK/trigger still denies CORE_CONVERSATION. This is a real **internal engineering and policy** gap, not just human approval.
2. **Official EOD and privileged operator:** Ed25519 verification and disposable-only nonce/revocation ledger are locally tested, but trusted independent human Owner/TL AAL2 key enrollment, server-verified signer registry and the actual independently reviewed atomic approval writer are absent. `VERIFIED_APPROVAL_WRITER_INSTALLED=false`; official EOD/operator actions intentionally hard-off.
3. **Staff lifecycle, dashboard operations and access:** many API routes, signed source adapters, read models, RLS and UI pathways exist, but the source was not installed in managed Staging. One MFA principal, no live Staff schema, no distinct Team Leader enrollment. Therefore real Staff work transitions, official EOD, granular grant editing, Staff chat and notification operations cannot be certified live.
4. **Managed database recoverability:** last authorized read-only Staging evidence: 86 applied migrations, latest `20261013144901`, P0-6 not applied, 0 VOX Staff tables, one verified MFA principal. Isolated PG17 restore was **provisionally semantically equivalent**, but 2 raw owner-only/default ACL catalog differences require a qualified DBA verdict. No verified current full-fidelity managed backup with ownership/ACL, Auth, Vault, Storage physical objects, PITR or approved rollback proof. Never blindly run `supabase db push --include-all` or repair the ledger.
5. **Approvals and genuine full-fidelity Staging acceptance:** independent qualified DBA/AppSec review/signatures, real Owner + distinct Team Leader AAL2, signed Owner operator approval, managed migration/rollback decision, signed Core/Web/worker deployment, real authenticated VOX module-by-module navigation and API 401/403/200/business E2E are **not completed**.

## Exact feature activation control

The existing VOX route guards require explicit environment-controlled flags, often the literal `staging`, and the actual protected schema. **Setting every feature flag to `staging` in Production or bypassing identity/consent is prohibited.** No blanket activation, no production config update, no payment/provider sends, no real marketplace activation. Review route guards, security invariants and platform-specific production activation design before any PROD GO.

## Fastest quality-preserving critical path

- Do NOT start new audit-only phases. Review and land **one consolidated main-compatible source candidate**. Resolve only genuine code and SQL dependency defects with actual tests and independent reviewer decisions.
- Complete genuine same-transaction Core consent/Staff writer and signed dual-human approval writer, then locally prove concurrent replay/revoke/nonce rollback under real auth and PG17.
- Obtain verified current managed Staging backup/recovery evidence with role/ACL/extension/Storage/DBA parity; qualified independent DBA/AppSec signoff + real Owner and separate TL AAL2. Those human gates cannot be fabricated by a model.
- Only then perform separately approved managed Staging migrations (P0-6, reviewed 7+23, overlay), signed deployments, smoke/auth/UAT and staged activation. Production release requires a later distinct signed GO.

**Final decision:** SOURCE BUILD/LOCAL SECURITY TESTS PASS. **Full-feature activation, managed Staging and Production are HOLD**, not production-ready. This packet is the factual release acceptance list, not a certification of external review.
