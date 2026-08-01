# QF-MVP-40.12-R3 — Index-proof bridge and real Meta semantic reconciliation

**Status:** offline repair. Four defects in the R2 runtime are closed. **No live execution occurred
in R3** — no Supabase connection, no Meta call, no write, and the staging seed is still not executed.

---

## 1. Where this sits

QF-MVP-40.12-R2 replaced a scaffold with a real runtime: read-only preflight, a single-use
15-minute cross-process attestation, and a bounded one-shot execute. That runtime existed but
carried four defects, all of which would have let an unsafe or unproven state through.

R3 closes them. It changes no send path, no migration, no approved payload and no consent authority.

---

## 2. Defect A — the index proof was hard-coded unavailable

R2's adapter always returned `INDEX_PROOF_UNAVAILABLE`, so a live preflight could never get past it.

**Independent read-only SQL against the staging project has since proved both indexes exist**, with
exactly the definitions the seed depends on:

| Index | Unique | Columns (ordered) | Predicate |
| --- | --- | --- | --- |
| `uq_comm_provider_template_active` | yes | `template_key, channel, provider_key, language` | `is_active` |
| `uq_comm_provider_template_mapping` | yes | `template_key, channel, provider_key, language, version` | — |

That result is **not** hard-coded into the operator, and it is **not** a permanent owner exception.
A hard-coded success would assert today's database shape forever; an exception would waive the check
entirely. Either would defeat the purpose — those two indexes are what make the conflict target
deterministic and make two competing active mappings structurally impossible.

Instead the operator consumes a **fresh external proof** at `QF_STAGING_INDEX_PROOF_PATH`, produced
out of band by direct read-only SQL. `verifyIndexProof()` refuses it unless:

- artifact, `environment: STAGING`, exact `project_ref` and exact `table` all match;
- `source` is `SUPABASE_DIRECT_READ_ONLY_SQL`;
- `proof_sha256` equals a deterministic digest of the body (tamper detection);
- it carries `issued_at_ms` / `expires_at_ms`, is not future-dated beyond a 60-second clock
  tolerance, has a TTL of **at most 15 minutes**, and has not expired;
- there are **exactly two** entries with the exact names, `unique: true`, the exact **ordered**
  columns and the exact predicate;
- the file lives **outside** the repository (`isInsideRepository()` refuses a repo-relative path).

The verified proof hash is pinned into the preflight attestation, and `--execute` re-verifies a
still-valid proof and refuses if the hash differs from the one the plan was approved against.

No RPC, DDL, migration or SQL function was added.

---

## 3. Defect B — the Meta semantic match was fabricated

R2's adapter requested only `name,language,status,category` and then returned `semanticMatch: true`
unconditionally. It had no components to compare, so the field asserted something it could not know.
Worse, the whole point of the check is to catch a remote template whose **body drifted** from the
approved copy — precisely the case that fabricated `true` would wave through.

Removed. The adapter now requests `name,language,status,category,components` — the same fields the
submission/reconciliation operator already reads — and compares the remote row against the approved
`creation_payload` using **the existing `templatesAreIdentical` / `canonicaliseTemplate`**, imported
from `submit-meta-templates.mjs`. No weaker local duplicate was written; a second comparator is
exactly how "semantic match" stops meaning anything.

That comparator compares exact body text (no trimming, no whitespace collapsing), component type and
order, and button order, type, text, `otp_type` and URL. The adapter **fails closed** when the
remote row carries no components to compare, and when more than one template matches the exact
name+language. Still GET-only; no remote id or raw response is logged or stored.

---

## 4. Defect C — conflicting rows outside the exact tuple

R2 classified only the canonical `(key, language, version)` tuple, so an **active row on another
version or language**, a duplicate tuple, an extra non-canonical row, a populated
`provider_template_id` or a non-approved row were all invisible — while any of them makes the seed
unsafe.

`scanMappingSet()` now scans **every** row for `provider_key = meta_whatsapp_cloud`,
`channel = whatsapp` and the eight keys, before anything is classified, attested or written. It
aborts on: any active row of any version or language; a duplicate canonical tuple; any row outside
the canonical language/version; a populated remote id; a non-approved row; or a drifted provider
name, category or `variables_schema`.

It deliberately does not lean on the unique indexes to rule out duplicates — the seed must not
depend on the very constraint it is about to rely on.

Post-write readback is correspondingly stricter: exactly one row per key, **exactly eight rows in
total** (an extra version or language row now fails rather than being filtered away), and each row
checked for canonical language, version, name, category, `variables_schema`, `approved`, inactive
and a null provider id.

---

## 5. Defect D — internal template language and version

`verifyInternalTemplates()` now requires all eight keys present, **no duplicate row per key**,
`language = en`, and a non-empty canonical `version` — which is the value the mapping rows are then
built from.

---

## 6. Attestation hardening

Stored-versus-fresh comparison now pins, in addition to R2's fields: `schema_proof`,
`index_proof_hash`, `runtime_policy_non_sendable` and the full `meta_reconciliation`. A plan approved
against one index proof or one set of remote template states cannot be executed against another.

---

## 7. Preserved from R2

Exact staging identity fence with production and Jarvis rejected by name; no `NEXT_PUBLIC` fallback;
no `.env` load; offline dry run; 15-minute single-use attestation; Meta GET-only; no `/messages`;
disabled provider-account contract; exactly eight inactive mappings; no `provider_template_id`; no
runtime or canary activation; no retry after an uncertain write; external sanitized evidence only;
typed business variable contracts; manifest/code binding parity.

---

## 8. Validation

| Gate | Result |
| --- | --- |
| `npm run test:mvp:40-12` | **167 passed, 0 failed** (51 rules, 38 mutants, 39 runtime tests, **39 R3 tests**) |
| `npm run test:mvp:40-12-r1` | 69 passed, 0 failed |
| `npm run test:mvp:40-11` | 77 passed, 0 failed |
| `npm run test:mvp:40-10a` | 193 passed, 0 failed |
| Wave 1 readiness validator | 102 passed, 0 failed |
| `npm run test:mvp:communication` | PASS |
| `npm run test:phase5f:d3b` | 93 passed, 0 failed |
| `npm run typecheck` | PASS |
| `npm run test:mvp:build-gate` | PASS |
| `git diff --check` | clean |

No test contacts Supabase or Meta — every effect is an injected fake.

---

## 9. Status

```
QF-MVP-40.12-R3 COMPLETE — OFFLINE ONLY
FRESH EXTERNAL STAGING INDEX-PROOF CONTRACT IMPLEMENTED
BOTH REQUIRED INDEX DEFINITIONS PINNED EXACTLY
FAKE META SEMANTIC MATCH REMOVED
REMOTE BODY/COMPONENT SEMANTICS VERIFIED BY REAL COMPARATOR
WHOLE-SET ACTIVE/CONFLICTING MAPPING SCAN IMPLEMENTED
INTERNAL TEMPLATE LANGUAGE/VERSION PROOF HARDENED
NO DATABASE OR META CALL IN THIS REPAIR
LIVE STAGING SEED STILL NOT EXECUTED
READY FOR A FRESH INDEX PROOF + SIX PROCESS VARIABLES + READ-ONLY PREFLIGHT
```

---

## 10. Explicitly NOT done

- No `--preflight-readonly`, no `--execute`, no Supabase connection, no Meta call from this repair.
- No RPC, DDL, migration or SQL function added.
- No provider account, mapping, runtime policy, webhook or canary created or changed.
- No message sent; no evidence or attestation file written.
- No change to send paths, app services, approved payloads, `outboundConsentScope.ts`, provider
  adapters, routes, migrations, generated DB types, `.env`, the lockfile or deployment files.
- `STAGING_SEEDED_INACTIVE` was **not** created — nothing has been seeded.

**To resume:** produce a fresh index proof by direct read-only SQL, point
`QF_STAGING_INDEX_PROOF_PATH` at it (outside the repo), load the six process variables, then run the
dry run → `--preflight-readonly` → exactly one `--execute`. The proof expires in 15 minutes, so
generate it immediately before the run.
