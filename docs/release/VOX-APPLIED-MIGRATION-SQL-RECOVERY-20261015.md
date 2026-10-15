# VOX Phase A — authoritative applied SQL recovered from Staging (15 Oct 2026)

**Status: evidence recovered; full historical replay NOT certified; RELEASE HOLD.**

This note documents a read-only examination of a genuine, previously SHA256
verified PostgreSQL 17.6 Staging archive for project
`uckafzuochmbvtiodmcl`. The archive SHA256 is
`aa6fac1f6c2bbd642b2de9cd707054ef3616a67561fa0c9678d95e4745a74af8`.
No SQL was read back from or executed against managed Staging during the
recovery. All local evidence remains owner-only on JARVIS, not GitHub, Notion,
CI artifacts, remote VPS, or chat.

## Authoritative ledger result

An isolated Supabase-matching PostgreSQL 17.6 instance was started with Docker
`--network none`, zero ports, ephemeral tmpfs storage and source archive
mounted read-only. Restoring `pg_restore --single-transaction --exit-on-error
--no-owner --no-acl` succeeded. The restored `supabase_migrations.schema_migrations`
contains 86 rows; 85 rows hold actual ordered SQL statement arrays. The sole
without statements is
`20260817000000_qf_mvp_80_03_audit_logs_forward_repair`.
Its SQL cannot be recovered from this ledger and needs archival-source proof.

Six previously *missing-by-filename* staging-only source definitions were
successfully recovered from the ordered SQL arrays. Their recovered
`md5(array_to_string(statements, chr(10)))` values **all six exactly
matched independent read-only live Staging ledger MD5s**, proving fidelity
to the stored applied SQL statements (not proving clean replay success).
These sources are private and may contain sensitive infrastructure data;
they must NEVER be committed automatically or executed outside an approved
network-isolated replay.

| Source version | Staging-only migration | Applied SQL statement count |
|---|---|---:|
| 20260722000100 | qf_mvp_staging_baseline_269c9265 | 821 |
| 20260926050242 | qf_phase2_staging_rls_initplan_parity | 1 |
| 20261012180214 | qf_vl01_vendor_assignment_update_authority_closeout_staging | 1 |
| 20261013053930 | vl05_scale_phase07_durable_jobs_hardening_staging | 1 |
| 20261013053959 | vl05_scale_phase12_horizontal_worker_claims_staging | 1 |
| 20261013144901 | vendor_profile_approval_atomic_v3_staging_20261013 | 1 |

## Repository comparison (strict text, NOT SQL-semantic proof)

All 86 applied ledger entries were compared by exact version, migration name,
and SQL body after normalizing line endings and trimming trailing boundary
whitespace. **Do not interpret merely identical names as equal SQL.**

| Category | Count | Text-equal | Text-different/absent |
|---|---:|---:|---:|
| Same version and name in current Core repo | 55 | 12 | 43 |
| Same name, different version | 25 | 22 | 3 |
| Staging-only filename not in current Core repo | 6 | n/a (source now securely recovered) | n/a |
| Total applied ledger rows | 86 | 34 | 52 (including 6 without filename) |

Three same-name/different-version candidates require line-level DBA review:

- `20260929161707_shared_single_number_jarvis_access`
- `20261002080447_vendor_fair_opportunity_distribution`
- `20261003081215_aarohi_full_fk_index_closeout`

The 43 text differences among same-version scripts may reflect separate
staging hotfixes, SQL formatting, comments or real logic changes.
**Text mismatch alone cannot establish a behavioral difference**, and
text equality does not certify that the migration can execute safely from
scratch. Retain an explicit DBA equivalence check and source chronology.

## Private artifact custody

On authorized JARVIS desktop, the owner-only `RestrictedExports` folder
holds encrypted-looking base64 transport data (not cryptographically encrypted
by itself), six reconstructed SQL files, and private SHA256/MD5 receipt
metadata. The source export and private report file SHA256s are:

- 86-record source ledger base64 export:
  `5cd77e0b4788cc0eb3de70c4dbf9daad8e94c1443e7ac42618516baa3f5ef5a6`
- Private 86-row SQL comparison metadata:
  `bb375ce859f5fbcafa20a34c1fdcbd6781469eafb88161fa4c5f35c6012f7f19`
- Private six-SQL receipt index:
  `7019a0243cbe173b64795dbf37937a28f8d051ccb88f8554c0ca78f100005938`

Security: ACL check showed only the owner identity. No raw SQL values,
email, phone, Auth tokens, user rows, service-role credentials or private
backup bytes are present in this Git document. Treat private base64 as
**sensitive plain SQL**, not as encryption.

The disposable local DB container was removed and absence verified. Original
stage archive integrity SHA256 matched after cleanup. All managed Staging
and production databases, Auth settings, public DNS and services remained
unchanged.

## Remaining hard gates before VOX launch

1. Independently audit the recovered stage SQL, all 43 same-version
   mismatches, three non-equal aliases and the one empty-statement
   historical repair. Prove safe full-history replay in disposable clean
   PostgreSQL17 staging-equivalent cluster, or explicitly document a signed
   alternate backup/restore acceptance scope.
2. Obtain independent DBA + owner recovery signoff (original object owners,
   cluster role bootstrapping, Auth runtime/SMTP, Storage bytes and complete
   rollback validation are not yet certified).
3. Keep the existing fail-closed CI reconciliation guard active. Do not
   silently edit `supabase_migrations.schema_migrations` or retimestamp
   applied SQL. Six recovered source locations do not mean six repo
   filename/version matches.
4. Complete staged synthetic VOX staff AAL2, cross-city authorization,
   recovery email/PKCE, idempotency/concurrency, Jarvis/AGNI agreement,
   Core route activation and vendor CRM/WhatsApp consent safety tests.
5. Require independently approved, signed OCI release and true staging
   deployment rollback evidence. GitHub staging self-review and admin
   bypass must remain blocked.

**Outcome:** six formerly unlocated authoritative SQL sources are recovered
and verified, a precise comparison report exists for all 86 versions,
but full historical migration and production launch certification remain
**HOLD**.
