# VOX operational in-flight deadlines — 2 November 2026

**Protected Draft PR #450, repository-only implementation. Managed Staging and Production remain on HOLD.**

**Core:** The actual native handler's post-RPC GoTrue/Staff re-verification had no deadline: an unresolved identity request could hold the response indefinitely after PostgreSQL had possibly committed. It now bounds the post-RPC recheck to a default of 1250 ms (25–2500 ms only in injected tests). Timeout returns redacted `503 STAFF_AUTH_RECHECK_TIMEOUT` with `committed:null`, `commitState:"unknown"`, `retrySameNonceOnly:true`, `providerMessagesSent:0`. It never asserts rollback, changes a nonce, or authorizes another mutation. The underlying SQL may have committed. Existing primary Staff AAL2 and SQL authorization are unchanged.

**EOD:** The genuine read-only Owner + distinct Team Leader double-snapshot review HTTP handler had no upper bound while both Auth and Data API were in flight. Its request now times out after 6000ms by default (25–10000ms in injected tests); no approved, published or provider-sent output is possible on timeout. Reader construction exceptions also return redacted 503 rather than exposing secrets. The reviewed PostgREST reader and all signing gates remain uninstalled.

**Validation:** The actual compiled Core/EOD HTTP handler test suites gained hanging-promise negative tests, and the protected source workflow executes those suites together with source-level immutable launch-gate checks. The real disposable PostgreSQL 17 Core/Finance/EOD workflows remain in place. Exact-head GitHub CI must finish before this change is called certified.

**Blocked external requirements:** Despite prior live read-only Staging catalog evidence of 86 managed migrations (one lacks retained original SQL), actual Staging lacks VOX Staff membership/team relations and reviewed Core/Finance/EOD RPCs. Independent managed SQL reconciliation and a full isolated Auth/Vault/Storage/roles/PostGIS/PITR restore, qualified independent DBA/AppSec review, real Owner plus distinct Team Leader MFA, Staff UAT and rollback approval are prerequisites for managed installation and Production GO.

No managed database/schema changes, money refunds, lead-credit grants, outbound provider messages, official EOD or Production activation were made.
