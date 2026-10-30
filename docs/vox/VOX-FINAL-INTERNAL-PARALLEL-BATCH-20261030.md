# VOX — Final parallel internal release engineering checkpoint (30 October 2026)

**Evidence state:** Internal-only QA; **Production and managed Staging migration HOLD**. No independent reviewer approval, Team Leader bootstrap, live positive three-role AAL2 proof, protected SQL install or signed new Core image is asserted here.

## Immutable baseline

- GitHub `main`: `2d5e1ecd093767d2b2c0aa3b3d657514987622e0` (#439-#441 merged).
- Existing running Core Staging image: `09b9d7a4`; existing VOX Web: `bdaac82d` (previously verified). New transition/EOD routes correctly return 404 until separate deployment.
- A separate clean JARVIS worktree was created; the older local `main` and all pre-existing worktrees are left alone.

## Independent workstreams and evidence

| Track | Completed safe internal work | Still blocked |
| --- | --- | --- |
| A — SQL/DBA | Repeatable fail-closed SQL preflight/postflight/ACL source checks 15/15; exact quarantined 7 + candidate 23 SQL manifest tests 3/3 on original AB7K worktree; offline five-schema restore is historical evidence, not rerun here | Canonical single SQL/RPC review, independent DBA/AppSec decision, current managed backup/roles/ACL drift, signed migration authorization |
| B — Staff identities | Scoped read 26/26; staff directory and review guard 25/25; approval queue 18/18; Work Queue 24/24 | Distinct real first Team Leader TOTP/AAL2, approved Staff scopes and grant/revocation positive UAT |
| C — Integration | Guarded transitions 16/16 and EOD source 25/25; owner overview managed schema contract 5/5 | New signed Core cutover, actual latest routes operational, real CRM/Vendor360/Desk/workflow integration with authentic identities |
| D — Security | New action/EOD negative HTTP contract 7/7; existing live Staging negative 18/18; new route pre-deploy HTTP 11/11; source-only CI regression runner added | Signed artifact/SBOM, full live three-role positive/negative test, revocation, concurrency and rollback evidence |
| E — Release | Explicit separate GO/HOLD checklist in issue #420 and Notion tracker | Independent qualified review and Owner/operator production GO |

The independently rerun source/default-deny + live negative suite on exact `main` passed **190/190**, not a full feature-complete production certificate. SQL 3/3 is separate evidence and is not added to this 190 subtotal.

## New reproducible QA command

```sh
node scripts/mvp/vox/validate-vox-final-internal-gates-20261030.mjs --self-test
node scripts/mvp/vox/validate-vox-final-internal-gates-20261030.mjs --source-only
```

Default is **source-only**. The following optional mode sends only the existing pinned public Staging negative-probe requests (GET and empty denied POST); it never supplies credentials, activates Staff features, sends provider messages, applies SQL or touches Production:

```sh
node scripts/mvp/vox/validate-vox-final-internal-gates-20261030.mjs --live-staging-denials
```

CI runs only self-test and source-only modes. No job has Staging environment secrets or deployment permissions.

## Mandatory GO gate

Do not mark fully functional or production-ready until (1) review/signature of the single canonical migration chain and exact ACL ownership and recovery, (2) genuinely independent Team Leader enrollment with verified AAL2 and scoped Staff grants, (3) approved managed Staging migration, (4) signed guarded Core Staging deployment with rollback, (5) live positive and negative Owner/TL/Staff end-to-end UAT, and (6) independent DBA/AppSec approval followed by Owner/operator Production GO.

Historical PR #419 Owner overview fix remains OPEN despite its endpoint already returning anonymous 401 in current Staging; determine obsolescence explicitly rather than blindly merging stacked historical code. #435 remains open and unapplied.

## Additional independent QA execution

- Composite runner self-test: **11/11**.
- Composite runner source-only: **161/161 PASS**.
- Composite runner with explicitly enabled public Staging denial checks: **190/190 PASS**.
- Isolated clean worktree `npm ci --ignore-scripts --no-audit --no-fund`: PASS.
- Isolated `npm run typecheck`: PASS.
- Isolated `npm run test:mvp:marketplace`: **87/87 PASS**.
- `npm audit --omit=dev --audit-level=high`: **0 reported vulnerabilities** at execution time.
- Scope limitation: no signed new Docker image, authenticated positive live AAL2, database migration or real four-source EOD certification.
