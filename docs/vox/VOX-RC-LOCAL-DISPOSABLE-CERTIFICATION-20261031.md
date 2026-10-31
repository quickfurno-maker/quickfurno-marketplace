# VOX PR #450 — Local disposable certification, 31 October 2026

## Scope and integrity

- Checked out the exact remote feature branch `feat/vox-rc6-operational-20261030` at starting SHA `9c35552ee3049590c446a304b788052099d89f77` in a fresh isolated worktree on the JARVIS Windows desktop.
- Installed dependencies from both lockfiles with `npm ci --no-audit --no-fund`; Node 24, Docker Desktop Linux engine, and pinned disposable Postgres/GoTrue/PostgREST images were available.
- **No managed Supabase environment was changed, no Razorpay provider request or credit grant was sent, and no real human signer was enrolled.** Existing unrelated Docker containers were not stopped.
- Production release, managed migrations, staff-writer enabling, financial actions and official EOD publication remain **HOLD**.

## Evidence: directly executed, exit code 0

| Execution | Recorded output |
| --- | --- |
| `node --test scripts/mvp/vox/rc16-razorpay-checkout-boundary.test.mjs scripts/mvp/vox/rc19-core-eod-source.test.mjs scripts/mvp/vox/rc20-finance-core-signer.test.mjs` | 27/27 PASS |
| `node scripts/mvp/vox/validate-vox-final-internal-gates-20261030.mjs --self-test` | 11/11 PASS |
| `node scripts/mvp/vox/validate-vox-final-internal-gates-20261030.mjs --source-only` | 161/161 PASS |
| `node --test scripts/mvp/vox/rc17-*.test.mjs scripts/mvp/vox/rc18-*.test.mjs scripts/mvp/vox/rc19-*.test.mjs scripts/mvp/vox/rc20-*.test.mjs` | 47/47 PASS after correcting a stale assertion |
| `node scripts/mvp/vox/validate-vox-rc17-razorpay-v2-real-pg17.mjs` | `VOX_RC17_REAL_PG17_RAZORPAY_V2_PASS funcs=5`; exact-once test credits, mode fencing, replay denial, restricted browser RPC, zero provider calls |
| `node scripts/mvp/vox/validate-vox-rc8-real-pg-vendor-core.mjs` | `VOX_RC12_REAL_PG17_AB7B_F1_SOURCE_ATOMIC_PASS`; `VOX_RC12_REAL_PG17_CLIENT_REVIEWED_PROJECT_SCOPE_PASS`; `VOX_RC8_CORE_REAL_PG17_VENDOR_CONSENT_WRITER_PASS`, real disposable PG17 atomic/rollback tests |
| `node scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs` | `VOX_RC8_REAL_PG17_SIGNED_INTENT_PASS`, synthetic keys, cryptographic tamper/replay/revocation denial; **official EOD false** |
| `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mvp/vox/validate-vox-03-real-local-gotrue-auth.harness.mjs` | `VOX_03_REAL_LOCAL_GOTRUE_OWNER_AUTH_PASS 8 passed, 0 blocked, 0 failed`; real local GoTrue TOTP AAL2, expiry, revoked-user denials; fixtures cleaned |
| Root `npm run typecheck` | PASS |
| `apps/vox-web/npm test` | PASS, including UI guard, source, role and workflow tests |
| `apps/vox-web/npm run build` | Next.js 16.3.8 production build PASS |
| `apps/vox-web/npm run typecheck` | PASS |
| `node scripts/mvp/vox/rc18-finance-release-recovery-preflight.mjs` | `VOX_RC18_RECOVERY_REVIEW_HOLD`: source inventory only, no managed database access |

## Actual failures corrected in the same consolidated PR

1. `scripts/mvp/vox/rc18-eod-recovery-finance.test.mjs` asserted the obsolete all-month Finance attention count. It now requires the selected India-month `monthScoped` count while preserving the no-refund/no-capture/no-credit constraints. The RC17–RC20 suite passed 47/47 on rerun.
2. `apps/vox-web/scripts/validate-unified-preview.mjs` asserted the obsolete ternary root splash. It now verifies local preview gating, staging-only verified AAL2 redirect to `/operations`, default locked fallback, and absence of privileged service-role access. The full VOX Web `npm test` passed on rerun.

## Not certified and remaining release blockers

These tests use disposable local databases and synthetic signers; they do not prove live managed Staging schema, production account permissions, human Owner/TL enrollment, real provider settlement, independent reviews, or all screens/actions functioning against live Core services. The candidate Finance SQL and genuine Core and EOD writer activation remain review-only / hard-off by design.

Before managed GO: independent DBA/AppSec review; full Supabase-compatible restore/rehearsed migration replay with Auth/Storage/Vault/RLS; refund and consumed-credit reconciliation approval; original canonical AB7B and consent-writer integration; human Owner/TL AAL2 and separate key ceremony; Staging end-to-end Staff/Vendor 360/Finance/CRM/EOD acceptance; explicit Owner Production approval.

GitHub Actions was previously observed queued; local desktop execution supplies real independent evidence but **does not imply a GitHub-hosted CI PASS**. Preserve Draft PR #450 and the managed Staging/Production release HOLD.

## Subsequent A–E parallel verification (31 October 2026, JARVIS desktop)

- **A / Isolated seven-migration disaster recovery:** ran `scripts/mvp/vox/validate-vox20-isolated-recovery.ps1` successfully: `VOX20_ISOLATED_PG17_SEVEN_MIGRATION_RESTORE_PASS migrations=7 vox_tables=10 rls_tables=10 profiles=2 cities=2 sha256_verified=true privileges_preserved=true restored_anon_denied=true live_staging_backup=false live_staging_modified=false`. This is synthetic PostgreSQL, NOT an exact live Supabase Auth/Storage/Vault and physical-storage restore.
- **A+B / Legacy V1 correction decision evidence:** added `scripts/mvp/vox/validate-vox-rc21-legacy-v1-parser-pg17.mjs`, which uses the original historical source and disposable `--network none` PostgreSQL 17 to confirm its first `AS $` function definition fails parsing and that initial `NULL::uuid IS DISTINCT FROM valid_token` is `true`. Actual marker `VOX_RC21_LEGACY_V1_PG17_PARSER_BLOCKERS_CONFIRMED`. The historical managed migration was **not** modified. This establishes why the V1 migration requires independent replay adjudication; it does not authorize a backfill or V2 installation.
- **B / Refund and payment:** `node --test scripts/mvp/vox/rc19-refund-evidence.test.mjs scripts/mvp/vox/rc18-payment-receipts.test.mjs` passed **7/7**. Refund with consumed credits remains refused pending independent human policy; no provider calls or credit revocations.
- **C+D / Core and EOD:** `node --test scripts/mvp/vox/rc17-core-consent-eod-security.test.mjs scripts/mvp/vox/rc19-core-eod-source.test.mjs scripts/mvp/vox/rc13-vox-eod-ci-runtime.test.mjs` passed **8/8**. Live native Core and official signer publication remain hard OFF.
- **E / Release pipeline:** Direct authenticated GitHub CLI showed Actions enabled on the repository and one online, idle self-hosted runner; nevertheless the PR workflows use `ubuntu-latest` and remained queued. This **does not establish the root cause** (runner account entitlements/usage need independent inspection). The offline V1 parser proof is now integrated into the RC17 GitHub workflow and disposable-container cleanup gate.
- **Release HOLD remains in force:** no managed Staging/Production changes, no refunds, no provider network calls, no verified live Staff enrollment, no human EOD signing and no approval to install review-only SQL. A final secure managed restore with Auth/Storage/Vault/roles/RLS, Owner and TL MFA, independent DBA/AppSec and complete Staging workflows remain open.
- **Final A–E retest:** `node --test scripts/mvp/vox/rc17-*.test.mjs scripts/mvp/vox/rc18-*.test.mjs scripts/mvp/vox/rc19-*.test.mjs scripts/mvp/vox/rc20-*.test.mjs` **48/48 PASS**; genuine isolated V2 PG17 five-function test **PASS**, V1 parser proof **PASS**, full VOX Web `npm test` **PASS**, root `npm run typecheck` **PASS**, and updated workflow YAML parsed successfully. Disposable test containers cleaned up.
