# VOX AB7K RC2 — #444 Three-Track Security/Recovery Candidate

**Date:** 2026-10-30. **Source base:** AB7K #379 / `7c7508a020720fd5b92b46ea2fab991d263c8d99`. **Status: DRAFT / HOLD / canApply=false.** This is not a signed managed Staging or Production release. Source analysis included Claude Sonnet AI reviews but **not an independent qualified human DBA/AppSec review**.

## Track A — AB7B native source contract

- Removed the never-shipped `public.vox_ab7b_current_consent_candidate_v1` dependency and unsupported `client_success_agent` role from the uninstalled AB7B candidate, without inventing a consent table.
- `CORE_CONVERSATION` is **intentionally BLOCKED** by a table CHECK and trigger before any Staff lookup until a reviewed consent source and canonical Staff role/department are bound. CRM_AAROHI and SUPPORT_DESK use their original least-privileged role + team/city/object/capability/nonce checks.
- Fingerprinted exactly one edited SQL candidate; **7 quarantined + 23 candidate files**, source aggregate SHA256 **`02a041d99b02ca7d638d2214cd52b142b426512ae714deb231c6f31b7d2b9388`**, all 30 per-file digests pinned in `VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json` (source pin, not human signoff).
- Local Node tests 8/8; four network-isolated PostgreSQL 17 suites PASS for Staff scope, nonce replay, CRM and Support atomic rollback, and conversation denial.

## Track B — AB7F/J trust + AB7G/H attestation containment

- New **separate uninstalled** `ops/vox/identity-attestation-overlay/20261030010000_vox_ab7k_identity_attestation_fail_closed_overlay.sql`; NOT included in the pinned 30, requires independent migration ordering/approval.
- AB7G/H owner approval and operator review writers remain **unimplemented**: unconditional always-on triggers reject inserts/updates/deletes/truncation even from a privileged database role. Three caller-UUID trusting service_role RPCs lose EXECUTE. SERVICE_ROLE cannot write AB7F–J ledgers via direct grants.
- AB7J Owner and Team Leader RPCs now check AAL2 and role with NULL-safe predicates; protected Owner release HTTP route is hard OFF. No self-signed or digest-only approval can activate EOD/Jarvis takeover.
- Source security tests 12/12; staged EOD HTTP test 5/5; disposable PG17 installed all 30 files **plus overlay and executed its SQL verification successfully**; TypeScript PASS before combining branches. **This does not prove genuine Ed25519 signer identity, complete Owner/TL end-to-end or executable approver writer.**

## Track C — Recovery/privilege evidence

- New exact Staging-only, read-only catalog/ACL/RLS/role/function-EXECUTE snapshot toolkit with fail-closed project-ref identity and matching 7+23 source fingerprints. Pure tests 10/10 PASS (combined integration tests: 33/33).
- Disposable PostgreSQL 17 full 30-file installation and rollback-oriented security catalog comparison ran on JARVIS, `--network none`. **Full-fidelity raw catalog comparison FAILED (exit 3)**; this is a genuine open review blocker.
- Differences at `vox_ab7j_staff_suspend_intents_candidate_v1.acl` and `.acl_is_default` (explicit owner-only ACL vs restored catalog's default/null ACL), and `vox_staff_team_messages_candidate_v1.constraints` (PostgreSQL deparser parentheses normalization). They may be semantically equivalent but **no automatic whitelist or ungrounded PASS**. DBA must compare effective privileges, all constraint behavior, owners, default ACL and migration restore outcomes.
- RC3 follow-up (authored, NOT EXECUTED): independent semantic comparator, SET ROLE behavior probes and negative control in `VOX-AB7K-RC3-RECOVERY-SEMANTIC-20261030.md`. The raw result above remains RAW_DIVERGENCE until that harness is run and a DBA interprets it.
- Deliberately lossy `--no-owner --no-acl` restore also differs. No verified managed Staging backup/roles/PITR/restore parity.
- Live managed Supabase Staging project `uckafzuochmbvtiodmcl`, read-only verification: **86 applied migrations**, latest `20261013144901`, **0 VOX Staff tables**, **1 verified MFA user**; canonical conversation/consent tables exist but consent authorization contract is not per-conversation. **No managed SQL/Auth, Production, provider-send or feature-flag changes were made.**

## Current GO/NO-GO

**NO-GO / keep #444 OPEN:** CORE_CONVERSATION, official EOD publication, signed Jarvis operator actions remain hard disabled. The required independent signed attestation writer/verifier, exact-bound owner/TL identity and consent semantics are not complete. Genuine distinct Owner/TL AAL2 acceptance, real Staging privileges/ACL-preserving restorable backup and independent DBA/AppSec signature are absent. Recovery raw catalog parity test is red.

**Next approved sequence:** (1) qualified owner/product security policy decision for conversation consent scope + canonical Staff role; implement trusted Core-bound read and actual writer, then test three source lanes; (2) pinned signature writer + independent review + replay/expiry proof; (3) adjudicate 3 recovery catalog differences and reproduce effective privilege parity on restore; (4) trusted real Owner/TL/Staff AAL2, reviewed forward migration sequence, qualified external DBA/AppSec signoff; (5) operator-approved Staging-only apply, signed Core/VOX build and controlled operational E2E; (6) separate explicit Production GO. **Never migrate by a blanket `supabase db push`, and never treat Claude/AI model reviews as independent signoff.**

Source receipts: `scripts/mvp/vox/validate-voxAB7K-core-conversation-blocked.test.mjs`, `validate-voxAB7K-identity-attestation.test.mjs`, `ab7k-readonly-evidence.test.mjs`, `validate-voxAB7K-recovery-harness-pg17.ps1`, and the four AB7B PG17 scripts. GitHub [issue #444](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/444), [existing AB7K #379](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/379), [release gate #420](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/420).
