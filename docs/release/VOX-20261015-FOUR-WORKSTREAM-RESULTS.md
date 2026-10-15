# VOX staging four-workstream execution — 15 October 2026

**Stage candidate engineering advanced; LAUNCH / DEPLOYMENT: RELEASE HOLD.**

Scope: authorized Windows JARVIS workstation, source-controlled draft VOX repositories,
read-only live Supabase Staging metadata, and **offline** Docker tests. No managed
Staging migration, production SQL, public DNS change, registry publish, image
signature, real staff invitation or external provider send was performed.

## Track 1 — Private VOX candidate image and CI

- Real candidate built on JARVIS from Core pinned draft PR #259 SHA
  `1eb62ddd4780dd97366e332c70a23f5dfd94c1aa`,
  `apps/vox-web/Dockerfile` with pinned Node base. Build exit 0.
- Local QA-only image tag `qf-vox-stage:qa-20261015`, image ID
  `sha256:4eb8986c5dac7eb42105e1a328b811edcfbe793f6b0de1f3a5a699c5307dc964`,
  size 361,725,175 bytes, runs as uid `10001`.
  **This is a local build identifier, not a published signed OCI digest.**
- Actual production Next.js process started in a disposable
  `--network none` Docker container, no ports, 768 MiB/0.5 CPU,
  non-root/read-only/drop caps: **7/7 runtime HTTP checks PASS**
  (health and safe HOLD view 200; overview, Vendor360, Service Desk,
  approved follow-ups, intelligence 503). Container removed afterward.
- Source verifier is
  `ops/vox/stage-host/verify-image-runtime.cjs`. Evidence PR #260
  CI `closed-image-source` builds an **exact separately pinned Core
  checkout** and runs the same offline test; its initial draft workflow
  assumed the evidence branch contained the application (failed);
  corrected to check out immutable Core SHA. CI after correction:
  **3/3 jobs successful** at `39c554405817cff96bd624e472213d4a9826f134`.
- Inert VPS template `/srv/qf-vox-stage/` remains root-owned, disabled,
  with no new listener, container, Traefik rule, deployment or public
  Cloudflare route. Existing Core, Jarvis and AGNI unchanged.
- **Not completed:** independent PR approval, merged source, signed/
  published digest, SBOM/provenance production checks and authorized
  private VPS activation.

## Track 2 — Applied migration SQL provenance

- Source database: Supabase **QuickFurno Staging**
  `uckafzuochmbvtiodmcl`. Read-only query of
  `supabase_migrations.schema_migrations` confirmed **86 entries**;
  **85 contain stored SQL statements** (1,521 SQL statement segments in total),
  one pre-existing entry has no stored statements. **Zero VOX**
  migrations have been applied to managed Staging.
- Compared in database **only cryptographic fingerprints/lengths and names**
  with the Core checkout; **no raw managed SQL or user data was
  extracted to JARVIS or posted in GitHub**.
- Current Core checkout migration names/versions: 55 exact, 25 staged
  versions with same-name repo files under different IDs, six staged
  migrations with **no same-name repo SQL file**.
- Of **25 version aliases**, **21** candidate files matched a stronger
  source SQL fingerprint *without stripping whitespace*
  (raw, CR-normalized or trimmed CR-normalized MD5);
  **23** matched after stripping whitespace; one additional matched
  only with line comments removed, and one did not match either
  conservative normalization. This is **evidence of candidate content
  equivalence**, **not proof** of full executable SQL semantics or
  clean database replay. In particular, blindly deleting whitespace
  inside string literals can change SQL semantics.
- All **six stage-only applied entries retain SQL text in the
  managed stage ledger**, including the 821-segment archival staging
  baseline. Original staging baseline also found as Git blob
  `65e56c0419a986cc14a5abcfb184dd4a82625630`, but it is
  **not byte-identical to the applied ledger's joined SQL**.
- Restricted local metadata-only receipts
  `D:\QuickFurno-Workspace\Artifacts\vox-stage-sql-fingerprints-20261015.json`,
  `vox-staging-applied-sql-comparison-20261015.json`,
  `vox-staging-applied-sql-strong-hashes-20261015.json`,
  `vox-staging-applied-sql-strong-comparison-20261015.json`
  (last SHA256 `6BB7910B1B59E204592F7AB057AFE1071EE5107EAD28A03CDB2D71BEFDA732DB`).
  Do not upload raw data/archive/secrets into GitHub or Notion.
- Genuine staging logical backup unchanged SHA256
  `aa6fac1f6c2bbd642b2de9cd707054ef3616a67561fa0c9678d95e4745a74af8`.
  Previous independent real archive restore + forward VOX SQL migration
  tests **7/7 PASS** offline; original PostgreSQL cluster ownership
  parity and historical replay **remain independently unapproved**.
- **Not completed:** authoritative full raw-SQL provenance approval for
  residual aliases, reconstructing stage-only migrations for replay,
  clean empty-database historical replay, owner+DBA signed exception/approval.

## Track 3 — Security

- Core VOX `validate-*.mjs`: **35/35 PASS**.
  VOX standalone Next.js source tests PASS and `tsc --noEmit` PASS;
  production build PASS; seven offline HTTP fail-closed checks PASS.
- Latest managed stage Supabase Security Advisor categories:
  `security_definer_view` **1 ERROR** (owner-rights public vendor
  projection), authenticated-callable definer RPC **2 WARN**,
  RLS-enabled/no-policy **102 INFO**. Leaked password warning
  previously cleared by owner. No automatic RLS or owner-rights changes.
- Managed Staging has **0 verified TOTP MFA factors**.
  Actual owner/Team Leader/non-admin staff/vendor AAL2 sessions,
  cross-city IDOR, revocation and alternate-factor MFA QA **NOT
  CERTIFIED**. Source tests alone are not sign-in evidence.
- Staging Auth provider TOTP enabled via owner screenshot, AAL1
  15-minute limit on. Auth default Site URL remains localhost
  with no redirect allowlist. VOX callback and password-reset
  flows need independent secure implementation/testing before
  redirects change.

## Track 4 — Core/Jarvis/AGNI integration

- Offline frozen Core/Jarvis/AGNI cross-repo contract **23/23 PASS**.
  Recovery parity source self-test positive 1 / negatives 14;
  security catalog positive 1 / negatives 10;
  identity matrix synthetic 10 positives / 5 mutation guards;
  signed evidence gate positive 1 / negatives 13.
  All are source/synthetic, not real stage tokens or broker actions.
- Jarvis VOX validators **8/8 PASS**.
- AGNI owner observation (13), owner attestation (10),
  PostgreSQL replay (7), signed replay integration (6):
  **36/36 Vitest PASS**. Temporary npm dependency junction
  removed; AGNI draft worktree clean.
- At check time, Core staged VOX overview route was HTTP 404
  and VOX public origin not deployed; backend private signed
  requests/live consent/WhatsApp/human handoff still **UNTESTED**.
- Source contract tests against frozen snapshots do not constitute
  live cross-repo deployment or signed image verification.

## Release gate — strict

Mandatory for any private rollout: separate trusted reviewer;
independently signed owner/DBA recovery and security decisions;
approved staging-only credentials; signed immutable image and
provenance; exact stage Core migration scope; real Supabase
AAL2/role/IDOR tests; then canary, rollback and consent/provider
negative tests. Owner chose existing JARVIS VPS for VOX **Staging
host only**, not to bypass these gates. Keep `vox.quickfurno.in`
DNS A record as `192.0.2.0` proxied placeholder until TLS+origin
verified and explicitly approved. **Production RELEASE HOLD.**
