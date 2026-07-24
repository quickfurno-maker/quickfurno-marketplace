# QF-MVP-20.3E — Legacy Assignment RPC EXECUTE Revocation

**Status: `E_PREFLIGHT_COMPLETE_READY_FOR_APPLICATION_REVIEW`.**

> **PREFLIGHT COMPLETE — NOT APPLIED.** The single authorized dry run (2026-07-24 11:01:33→11:01:38Z,
> exit 0) proposed exactly Migration E and wrote nothing; the live pre-state proves E is an ACL no-op
> (the six are already `service_role`-only). Production and QF-Jarvis were never accessed. E is not
> applied; nothing pushed beyond the two already-pushed E commits.

Generated at branch `mvp/qf-mvp-20-marketplace-engine-v1`, from the synchronized HEAD
`2210ac71cac222b719613eb1b9c12c8e49ac5148` (D applied and verified 37/37), origin identical,
ahead/behind 0/0, clean tree. No collision for `20260723000800`; D was the highest migration.
**Corrected in QF-MVP-20.3EGR1** on top of the generation commit `26bd744` — the durability
overclaim was retracted (see §2a); the executable REVOKE/GRANT design is unchanged.

| Artifact | SHA-256 |
|---|---|
| `supabase/migrations/20260723000800_qf_mvp_legacy_assignment_rpc_execute_revocation.sql` *(comment-only correction)* | `94c696cdd5c1e91ad75222aa8cad544daf8c5271b1453fb78729bd62d7db520a` |
| `scripts/mvp/staging/validate-qf-mvp-20-3e.mjs` *(51/51, +R12)* | `2e9ef53a8e4fb6822bfc4b479cddcef7ebf5c14dcff1040b864baaa263960b0b` |
| `supabase/staging-verification/verify_qf_mvp_20_3e.sql` *(21 rows, unchanged)* | `a4ab76fa5df9d4b23b64618976ab89e41178239c643cc65a381e01f9782f3115` |
| `scripts/mvp/staging/qf-mvp-20-3e-manifest.json` *(definition-immutability manifest, unchanged)* | `8bfba9662e2a74a39c32e671419251d2db8ce233fc708cfad5540bdb90282c4a` |

---

## 0-B. Staging preflight (QF-MVP-20.3EP) — COMPLETE

The preflight, on the synchronized HEAD `fc12992` (both E commits pushed; origin identical, 0/0),
passed end to end. **Source-proof gate PASS:** the validator (51/51) structurally requires the six
signature-qualified targets, PUBLIC/anon/authenticated revokes, service_role retention, safe/canonical
exclusions, the no-DDL/no-broad/R12 current-object contract, and a SELECT-only verifier; the verifier
reads **actual catalogs** (`to_regprocedure` ×31, `has_function_privilege` ×62, `pg_proc`/`pg_trigger`/
`pg_get_function_result`) with **zero** `obj_description`/`prosrc`/`pg_get_functiondef` — not a
COMMENT-only proof.

External apply workspace held exactly 8 SQL files (baseline→D, hash-exact); E was **absent** (case A),
so corrected E was copied in and proved **byte-identical** to the repo (`94c696cd…`, 16023 bytes) →
9 SQL files. Linked target **`uckafzuochmbvtiodmcl`**; production/QF-Jarvis not linked, connected or
referenced.

**Live pre-state ACL matrix (SELECT-only, no RPC invoked) proves E is a no-op:** all six targets
already have PUBLIC/anon/authenticated EXECUTE **absent** and service_role **present** (owner
`postgres`, SECURITY DEFINER, `jsonb`, matching the manifest); `get_public_eligible_vendors` keeps
anon/authenticated/service_role EXECUTE (STABLE, TABLE result); `qf_assign_lead_vendors_v2` is
service_role-usable and never anon/authenticated-executable. The six therefore **already satisfy E's
desired posture** — E's REVOKE/GRANT are idempotent no-ops; its value is the catalog-verification
milestone and the explicit history checkpoint.

**Migration history before** the dry run: **9 local / 8 remote**, E (`20260723000800`) the sole
pending migration. **The single authorized `npx supabase db push --linked --dry-run`** (2026-07-24
11:01:33→11:01:38Z, **exit 0**) proposed **exactly one** migration —
`20260723000800_qf_mvp_legacy_assignment_rpc_execute_revocation.sql` — under an explicit `DRY RUN`
banner, no earlier migration, no application claim. **History after** was **byte-identical** (8 remote,
E still local-only), and a repeated SELECT-only ACL snapshot was unchanged with `schema_migrations`
rows for `20260723000800` = **0**: **zero** write, E not recorded, no RPC invoked. Transcript
`QF-MVP-20.3EP-PREFLIGHT-…txt` in the external evidence workspace, never committed. **Next: E staging
application.**

---

## 1. What E does

E pins the EXECUTE posture of the **six legacy, state-changing lead-assignment RPCs** to
**server-owned authority only** — EXECUTE revoked from `PUBLIC`, `anon` and `authenticated`, retained
for `service_role`. It is **ACL-only**: it drops/creates/alters no function, touches no table,
policy, index, trigger or row, uses no `ALTER DEFAULT PRIVILEGES` and no broad schema revoke, and it
leaves the safe public discovery RPC untouched.

## 2. Reconciliation — E is defence-in-depth, not a live-hole fix

**HONEST FINDING.** The applied QF-MVP-20.2 baseline **already** carries, for all six targets,
`REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO service_role`, and **no applied
migration (A/A2/B1/G/B2/C/D) re-creates or re-grants any of them** (verified by grepping every applied
file — only Migration C mentions one, in a comment noting `get_public_eligible_vendors` keeps its
anon grant). The QF-MVP-20.3D security advisors independently confirm this: the anon/authenticated-
executable SECURITY DEFINER functions on staging are `get_public_eligible_vendors`, `rls_auto_enable`,
`is_admin`, `owns_vendor` — **none of the six**.

So on the current staging state the six are **already** `service_role`-only. **E does not close an
open exposure.** Its value is a **current-object ACL re-assertion plus a catalog-verification
milestone**: it pins the ACLs of the six function objects that exist at E's application time (a no-op
on the accepted current posture, since they are already `service_role`-only), and its verifier proves
that posture from catalog facts. The six-RPC count reconciles **exactly**: six reported, six targeted,
six already locked.

### 2a. Honest durability contract (QF-MVP-20.3EGR1 correction)

The original generation report claimed E is an *"idempotent re-assertion surviving any future
DROP+CREATE ACL reset."* **That guarantee is impossible and is retracted.** The PostgreSQL ACL
lifecycle is:

| Operation | ACL effect | Does E cover it? |
|---|---|---|
| `REVOKE` / `GRANT` on the current object | mutates the current function's ACL; re-running is idempotent for that identity | **Yes** — this is exactly what E does at application time |
| `CREATE OR REPLACE FUNCTION` (same identity) | normally **preserves** the existing object's ACL | ACL survives; E separately forbids body/signature changes to a target |
| `DROP FUNCTION` + `CREATE FUNCTION` (later migration) | old object **and its ACL are destroyed**; the new object gets **creation-time defaults — PUBLIC gets EXECUTE** | **No** — E applies once, does not re-run, and does not alter default privileges |

E is therefore a **current-object** guarantee, not a future-object one. Because E intentionally does
**not** use `ALTER DEFAULT PRIVILEGES`, it makes no promise about objects created after it.

**Forward governance obligation (not a database mechanism).** Any later migration that recreates one
of the six target signatures **MUST**, in the same migration: (1) `REVOKE EXECUTE … FROM PUBLIC,
anon, authenticated`; (2) re-`GRANT EXECUTE … TO service_role`; and (3) re-validate/update the
immutability manifest if a definition change is separately authorized. The repository gates must
reject a recreated state-changing RPC that lacks the required ACL posture. This validator (rule
**R12**) encodes the obligation for E itself; a future recreation phase must carry its own equivalent
check.

## 3. Complete assignment-RPC inventory

| Function (identity signature) | Class | SECURITY | Current EXECUTE (baseline) | E action |
|---|---|---|---|---|
| `admin_smart_assign_lead_to_vendors(uuid, uuid[], boolean, integer)` | LEGACY_STATE_CHANGING_RETAIN_SERVER_ONLY | DEFINER | service_role only | **re-assert** |
| `assign_client_selected_vendor_to_group(uuid, uuid, uuid, integer)` | LEGACY_STATE_CHANGING_RETAIN_SERVER_ONLY | DEFINER | service_role only | **re-assert** |
| `assign_lead_to_paid_vendors_phase26a(uuid, uuid[])` | LEGACY_STATE_CHANGING_RETAIN_SERVER_ONLY | DEFINER | service_role only | **re-assert** |
| `assign_lead_to_preferred_vendor(uuid, uuid)` | LEGACY_STATE_CHANGING_RETAIN_SERVER_ONLY | DEFINER | service_role only | **re-assert** |
| `assign_lead_to_vendors(uuid, uuid[], boolean, text)` | LEGACY_STATE_CHANGING_RETAIN_SERVER_ONLY | DEFINER | service_role only | **re-assert** |
| `assign_vendor_to_requirement_group(uuid, uuid, uuid, text, integer, text)` | LEGACY_STATE_CHANGING_RETAIN_SERVER_ONLY | DEFINER | service_role only | **re-assert** |
| `qf_assign_lead_vendors_v2(uuid, text, uuid[], text, text, uuid, uuid, text)` | CANONICAL_STATE_CHANGING_SERVER_ONLY (B1) | DEFINER | service_role only | **excluded** (verify only) |
| `get_public_eligible_vendors(text, text, text)` | SAFE_READ_ONLY_PUBLIC | DEFINER | service_role, anon, authenticated | **excluded** (must keep) |
| `qf_apply_credit_mutation_v2(…)`, `qf_apply_vendor_credit_delta(…)`, `deduct_vendor_credit`, `restore_vendor_credit`, `increment_vendor_credits` | OUT_OF_SCOPE (credit, not lead-assignment; not anon/authenticated-granted) | — | server-owned | **excluded** |
| `assign_package_to_vendor(…)` | OUT_OF_SCOPE (package, not lead-assignment) | — | server-owned | **excluded** |
| B2 enforcement functions / triggers (`qf_enforce_*`, `trg_lead_assignment*`) | TRIGGER_FUNCTION (B2) | — | — | **excluded** |

**Frozen target set = exactly the six LEGACY rows.** No credit/package function is a state-changing
*lead-assignment* RPC, and none is granted to anon/authenticated in the baseline, so including them
would be scope expansion.

## 4. Grant matrix

**Current (applied baseline) and Desired (after E)** are identical — E re-asserts, it does not change:

| Role | Six legacy RPCs | `get_public_eligible_vendors` | `qf_assign_lead_vendors_v2` |
|---|---|---|---|
| PUBLIC | none | none | none |
| anon | none | **EXECUTE** | none |
| authenticated | none | **EXECUTE** | none |
| service_role | **EXECUTE** | **EXECUTE** | **EXECUTE** |
| postgres/owner | inherent | inherent | inherent |

**Why PUBLIC must be named in every REVOKE:** `PUBLIC` is a pseudo-role every role belongs to; a
function's default ACL grants EXECUTE to PUBLIC, so revoking only `anon`/`authenticated` would leave
both able to execute **via PUBLIC**. Each `REVOKE` therefore names `public, anon, authenticated`
together. Validator rule **R06** fails E if any REVOKE omits one of the three.

## 5. Runtime call-site proof

| RPC | Live `.rpc()` call site | Client | Role |
|---|---|---|---|
| the six legacy RPCs | **none** — appear only in explanatory comments ("no longer called", "not a fallback") | — | — |
| `qf_assign_lead_vendors_v2` | `services/canonicalAssignmentAuthority.ts:81` | `adminClient()` | **service_role** |
| `get_public_eligible_vendors` | `services/leadService.ts:351` | `publicClient()` | **anon** |

QF-MVP-20.3R1 migrated every runtime consumer onto the canonical authority, so **no browser/anon/
authenticated path depends on direct EXECUTE of any of the six** (validator check 14 proves zero
`.rpc("<legacy>")` calls). The canonical path is server-owned (service_role); the safe discovery RPC
is called with the anon client and therefore **must** keep anon EXECUTE — which is why E excludes it.
**No runtime change was required, and it is proved** (checks 14–16). The `E_BLOCKED_RUNTIME_DEPENDS_
ON_AUTHENTICATED_ASSIGNMENT_RPC` stop condition does not apply.

## 6. Definition-immutability manifest

`scripts/mvp/staging/qf-mvp-20-3e-manifest.json` records, for each of the six: schema, name, identity
args, result type (`jsonb`), `security_definer: true`, volatility, language, search_path, and a
`body_sha256` over the whitespace-normalised dollar-body of the applied baseline definition. The
validator (check 12) **re-derives every body hash from the baseline** and requires a match, so the
manifest is provably faithful; combined with the migration's no-DDL rule (**R02**), this proves E
cannot have changed any body, signature, security mode or return type — E changes ACLs only.

## 7. Validator and verifier

**Offline validator** — `scripts/mvp/staging/validate-qf-mvp-20-3e.mjs`, **51/51 PASS**. One
`evaluateEMigration()` grades the migration (rules R01–R12, **22 one-defect fixtures**), one
`evaluateEVerifier()` grades the verifier (V01–V08, **6 fixtures**), plus manifest-faithfulness and
runtime-posture checks. Anti-vacuity guards flag any no-op mutation; check 05 proves every enforced
migration rule has a fixture. Required mutations all caught: leave PUBLIC/anon/authenticated EXECUTE
(A/B/C → R06); revoke service_role (D → R07); revoke the safe public RPC (E → R08); omit a target /
add an unrelated RPC / unqualified name (F/G/H → R05); DROP / CREATE OR REPLACE / ALTER a target
(I/J/K → R02); ALTER DEFAULT PRIVILEGES / broad schema revoke (L/M → R04); table/data mutation
(N/O → R03); owner-binding column (P → R10); functiondef assertion / removed self-verification
(Q/R → R09); verifier DML (VF1 → V01); comment/source proof in the verifier (VF2 → V03); dropped
target/safe/canonical/role assertions (VF3–VF6).

**Rule R12 — the honest durability contract (QF-MVP-20.3EGR1).** A dedicated structural rule proves
E is a *current-object* ACL operation only: no `ALTER DEFAULT PRIVILEGES`, no `ON ALL FUNCTIONS/
ROUTINES` or `ON SCHEMA` grant/revoke, and **every** executable EXECUTE grant/revoke is
signature-qualified against a specific overload identity. Its absence of any default-privilege
mechanism is exactly why E makes no false future-object promise. Fixtures **T** (ALTER DEFAULT
PRIVILEGES shortcut), **U** (schema-wide `ON ALL FUNCTIONS` revoke) and **V** (an unqualified,
arg-list-less target) all trip R12.

**SELECT-only verifier** — `supabase/staging-verification/verify_qf_mvp_20_3e.sql`, **21 rows**, one
`SELECT … UNION ALL` chain, no DML/DDL, never invokes an assignment RPC. Per-target rows (E03–E08)
each prove a single overload is `server_only`; E09 is the aggregate cross-check (untrusted EXECUTE
across all six = 0); E10 proves all six remain SECURITY DEFINER `jsonb`; E11 preserves the safe public
RPC's anon/authenticated grant; E12 proves the canonical authority is service-usable and never anon/
authenticated-executable; E13–E17 preserve B1/B2/G/C/D; E18 confirms the six remain present; E19/E21
fence owner binding and QF-MVP-20.4. It carries forward every locked policy: no `pg_get_functiondef`/
`prosrc` assertion, catalog `name` compared as text (E20 owners cast `::text`), no asymmetric arrays.

## 8. Independent review — findings

Reviewed for PUBLIC/implicit-grant leakage, wrong-overload revocation, retained authenticated
invocation, a broken canonical service-role path, a broken safe discovery path, definition drift,
unsafe SECURITY DEFINER surfaces, stale browser call sites, accidental semantic changes and scope
expansion.

**One material robustness defect found and corrected:** verifier row **E20** aggregated function
owners with `string_agg(pg_get_userbyid(proowner), …)` — `pg_get_userbyid` returns `name`, and
`string_agg`'s first argument must be `text`, so this would raise a type error at execution (the
QF-MVP-20.3B2R1 `name`-vs-`text` defect class). Corrected to `pg_get_userbyid(proowner)::text` on both
the aggregate and its `ORDER BY`.

No other defect survived review. The `has_function_privilege(text-signature, …)` calls in the
per-target rows are safe because the six are guaranteed present (baseline + E drops nothing + E's own
transactional self-verification aborts before the verifier ever runs if any target is missing).

## 9. Scope proof

E does **not**: drop/rename/recreate/alter any function; change any RPC argument, return type, body,
volatility, security mode, search_path or owner; alter assignment caps, replacement, eligibility,
credit, lineage or audit behaviour; revoke the safe public discovery RPC; use broad/default-privilege
changes; touch tables/policies/indexes/triggers/data; implement QF-MVP-20.4, owner binding, the
`profiles` table-GRANT or `admin_role` cleanup. Enforced by validator rules R02–R04, R08, R10, R12 and
verifier rows E10–E21.

## 10. Disclosed follow-ups (still tracked, out of scope)

1. **`profiles` `authenticated` table-GRANT** — mandatory separate follow-up before final marketplace
   closeout (browser/SSR `profiles` reads lack a base table privilege). Untouched by E.
2. **`profiles.admin_role` drift** — inert schema-cleanup follow-up. Untouched by E.

## 11. Gates

| Gate | Result |
|---|---|
| `npm run test:mvp:e` | **51 passed, 0 failed** · 22 + 6 fixtures |
| `npm run test:mvp:d` | **110 passed, 0 failed** |
| `npm run test:mvp:c` | **83 passed, 0 failed** |
| `npm run test:mvp:b2` | **61 passed, 0 failed** |
| B1/G validator | **165 passed, 0 failed** |
| `npm run test:mvp:r1` | **62 passed, 0 failed** |
| `npm run verify:mvp` (now runs the E validator too) | **exit 0** |
| typecheck / lint / build | clean, exit 0 |
| `git diff --check` | exit 0 |

**Deviation:** `verify:mvp` gained `test:mvp:e`, and the R1 harness's declared-later-migrations set
gained the E filename (its phase-progression guard). Both strictly strengthen the gate.

## 12. Next phase

**QF-MVP-20.3E staging application** — the preflight (EP, §0-B) is complete: the source-proof gate is
satisfied, the live pre-state proves E is an ACL no-op (the six are already `service_role`-only), the
dry run proposed exactly `20260723000800` at exit 0, and no write occurred. The application phase runs
the single authorized non-dry-run `npx supabase db push --linked` to record exactly Migration E, then
the SELECT-only verifier (`verify_qf_mvp_20_3e.sql`, 21 rows) confirms the posture. **Not** QF-MVP-20.4,
**not** owner binding. Migrations A, A2, B1, G, B2, C and D remain applied and immutable; the two
disclosed follow-ups (`profiles` `authenticated` table-GRANT — mandatory before final closeout; inert
`profiles.admin_role` drift) remain open and out of scope.
