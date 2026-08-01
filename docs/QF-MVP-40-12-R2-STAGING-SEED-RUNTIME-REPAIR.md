# QF-MVP-40.12-R2 — Staging seed runtime repair

**Status:** offline runtime repair. `--preflight-readonly` and `--execute` are now real and
reachable. **No live execution occurred in this repair** — no database connection, no Meta call,
no write.
**Scope:** no Supabase, no Meta, no credentials loaded, no provider account, no mapping, no runtime
policy, no message, no migration, no deployment.

---

## 1. The defect

The operator committed at `16fd16a` was a scaffold. After the canonical binding fence and the
environment identity fence it ran, unconditionally:

```js
console.error("REFUSED: PREFLIGHT_NOT_SATISFIED — live staging execution is gated on …");
process.exit(2);
```

So `--preflight-readonly` and `--execute` could never do anything. The safety fences were real; the
work behind them was not. The earlier report was accurate that Stage B had not run — but the reason
was partly that it *could* not, and that needed saying plainly and fixing rather than bypassing.

No bypass flag was added. The refusal is replaced by the runtime it was standing in for.

---

## 2. Cross-process preflight design

Each `npm run` is a **separate process**, so an in-memory "preflight passed" boolean would be
meaningless — `--execute` would either trust nothing or trust itself. Option A from the brief is
implemented: a **sanitized, short-lived, single-use attestation** written outside the repository.

`--preflight-readonly` performs the full read-only proof and writes an attestation pinning:

| Pinned | Why |
| --- | --- |
| `head`, `branch` | the plan belongs to an exact commit |
| `project_ref`, `environment` | the plan belongs to staging |
| `manifest_hash`, `readiness_hash`, `binding_contract_hash` | the inputs have not moved |
| `template_keys` (8) | the set has not changed |
| `schema_proof`, `index_proof` | the database shape was proven |
| `meta_reconciliation` | all eight were APPROVED / UTILITY / en / semantic match |
| `mapping_plan`, `account_classification` | the exact intended outcome per key |
| `runtime_policy_non_sendable` | no send path was open |
| `nonce`, `issued_at_ms`, `expires_at_ms` | single use, **15-minute** TTL |
| `attestation_sha256` | tamper detection over the whole body |

`--execute` does **not** trust that file on its own. It **reruns the entire read-only preflight**,
then requires the stored attestation to match the fresh result on every pinned field. A missing,
expired, replayed, tampered or drifted attestation is refused with a distinct sanitized code
(`ATTESTATION_MISSING`, `_EXPIRED`, `_ALREADY_CONSUMED`, `_TAMPERED`, `_MISMATCH`). The nonce is
consumed only after every post-write proof passes.

The attestation contains **no secret and no raw identifier** — no token, WABA id, phone-number id,
row UUID, remote template id, project URL or raw response.

---

## 3. What each mode now does

**default (offline dry run)** — unchanged: no credential, no client, no network, no write.

**`--preflight-readonly`** — after the identity fence, constructs the client and proves:

1. the four required tables are readable with the exact selected columns;
2. index metadata — see §4;
3. all eight internal template keys exist, with canonical `version` and language;
4. Meta identity: the phone number belongs to the exact WABA (GET);
5. each of the eight resolves to **exactly one** APPROVED / UTILITY / `en` / semantically matching
   remote template (GET);
6. existing mappings classify as `MISSING` / `ALREADY_PRESENT_INACTIVE` / `CONFLICT` — any conflict
   or any **active** row aborts the whole plan;
7. the account classifies as `CREATE_DISABLED` / `NORMALIZED_DISABLED` /
   `ALREADY_PRESENT_DISABLED` / `ABORT`;
8. runtime policy is missing or non-sendable.

**Zero writes** — the db port's write methods are never called on this path, proven by a fake that
counts them.

**`--execute`** — reruns all of the above, verifies the attestation, then performs **at most two
writes**: the disabled account, and one bulk insert of only the missing mappings. Then it reads back
and proves eight rows, all `is_active false`, all `approved`, all `provider_template_id null`, exact
names and category, the account still `disabled`, and the runtime policy still non-sendable. Any
error or ambiguous result is `WRITE_OUTCOME_UNCERTAIN` and is **never retried**.

---

## 4. An honest gap: `INDEX_PROOF_UNAVAILABLE`

The brief requires proving `uq_comm_provider_template_mapping` and
`uq_comm_provider_template_active` exist — and says to return `INDEX_PROOF_UNAVAILABLE` if that
cannot be done through an already-authorized path.

It cannot. PostgREST does not expose `pg_indexes`, and this phase may not add an RPC, DDL or
migration to reach it. So `proveIndexes()` returns `INDEX_PROOF_UNAVAILABLE` rather than pretending.
**A live preflight will therefore stop there** until an authorized read path exists. That is the
correct fail-closed behaviour: the indexes are what make the seed's conflict target deterministic
and make two competing active mappings structurally impossible, so proceeding without proving them
would be proceeding on assumption.

Resolving it is a separate, explicitly authorized decision — either a read-only RPC or an accepted
documented exception. I did not choose one unilaterally.

---

## 5. Boundaries preserved

- **Staging fence** — exact ref `uckafzuochmbvtiodmcl`; production and Jarvis refs rejected by name;
  any other ref rejected; malformed/non-HTTPS URLs rejected; `NEXT_PUBLIC_SUPABASE_URL` is never a
  fallback; no `.env` is loaded. The fence runs **before** `createClient`.
- **Meta GET-only** — no POST/PUT/PATCH/DELETE, no `/messages`.
- **Account never send-capable** — `readiness_status: disabled`, `configuration_status: partial`,
  `webhook_status: pending`, `health_status: unknown`, `billing_status: unknown`; the four
  send-capable values are refused at write time.
- **Exactly eight, all inactive** — never a ninth, never `is_active true`, never a stored remote id,
  never an overwritten active row, never a deactivation.
- **Credentials** — never logged. The access token appears only in an `Authorization` header; the
  WABA id only in the Graph URL path that addresses the account; the service-role key only reaches
  `createClient`. Raw provider errors are never surfaced.

---

## 6. Tests

`npm run test:mvp:40-12` — **128 passed, 0 failed** (51 rules, 38 mutation self-tests, **39 runtime
tests**). Every external effect is an injected fake, so the suite opens no socket, no database
connection and reads no credential.

The runtime suite proves, among other things: the unconditional refusal is gone (`R1`); preflight
performs real reads and **zero** writes (`R4`, `R5`); every fail-closed branch blocks before any
write (`R9`–`R18`); execute reruns the full preflight before touching the attestation (`R20`);
expired / replayed / tampered / drifted attestations are refused (`R21`–`R25`); the happy path
writes exactly eight inactive mappings and a disabled account (`R26`, `R27`); a re-seed is
idempotent with **zero** writes (`R28`); the nonce is consumed exactly once (`R29`); an uncertain
write is not retried (`R30`); and readback failures on an active row, a stored remote id or a
sendable policy all fail closed (`R31`–`R33`).

Three rules I wrote earlier were too blunt against the new code and were corrected rather than
suppressed: the no-retry rule flagged the console message that *documents* the guarantee; the
credential rule banned the interpolation the Authorization header requires; and the evidence-path
rule assumed a literal separator that `path.join` segments no longer produce. Each now asserts the
invariant instead of the spelling.

Full regression: 40-12-r1 69/69 · 40-11 77/77 · 40-10a 193/193 · wave1 102/102 · 40-2/3/4/6/8 all
green · communication PASS · d3b 93/93 · typecheck PASS · build-gate PASS · `git diff --check` clean.

---

## 7. Status

```
QF-MVP-40.12-R2 COMPLETE — OFFLINE RUNTIME REPAIR
UNCONDITIONAL PREFLIGHT REFUSAL REMOVED
READ-ONLY PREFLIGHT IMPLEMENTED
CONTROLLED ONE-SHOT EXECUTION IMPLEMENTED
STAGING IDENTITY FENCE PRESERVED
META GET-ONLY FENCE PRESERVED
EXACT EIGHT INACTIVE MAPPINGS PRESERVED
PROVIDER ACCOUNT REMAINS DISABLED BY CONTRACT
NO DATABASE OR META CALL IN THIS REPAIR
LIVE STAGING SEED STILL NOT EXECUTED
READY TO RELOAD SIX PROCESS VARIABLES AND RUN READ-ONLY PREFLIGHT
```

---

## 8. Explicitly NOT done

- No `--preflight-readonly` and no `--execute` run, not even to see them refuse.
- No Supabase connection, read, write, migration or DDL, in any environment.
- No Meta call; no credentials loaded, requested or read.
- No provider account, mapping, runtime policy, webhook or canary created or changed.
- No message sent; no evidence file written.
- No change to `outboundConsentScope.ts`, provider adapters, send paths, routes, migrations,
  generated DB types, `.env` files, the lockfile, n8n/Jarvis or deployment files.
- The final `STAGING_SEEDED_INACTIVE` result artefact was **not** created — nothing has been seeded.

**Next:** load the six phase-scoped variables into the process environment only, then run the dry
run, then `--preflight-readonly`. Expect it to stop at `INDEX_PROOF_UNAVAILABLE` (§4) until that
decision is made.
