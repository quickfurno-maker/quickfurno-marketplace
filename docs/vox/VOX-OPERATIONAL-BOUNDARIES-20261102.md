# VOX — bounded operational identity and financial RPC paths

**2 November 2026.** Repository-only amendments to Draft PR #450. Source changes **DO NOT** constitute a managed Staging installation or human approval.

The VOX Staff Web Core adapter now waits at most 10,000ms to exceed the full native Core route budget (1,500ms initial boundary AAL2 + 1,250ms handler AAL2 + 3,500ms PostgreSQL RPC + 1,250ms post-SQL AAL2 = 7,500ms), with 2,500ms transport allowance. A Web abort still produces an uncertain commit outcome and retains the original nonce. The separate read-only conversation candidate discovery retains its shorter deadline.

The actual **Core** HTTP operator and its native atomic handler now both bound **pre-transaction Staff GoTrue/AAL2 verification**. A hung first-hop identity request returns HTTP 503 with a confirmed no-commit result and never invokes SQL. Existing **post-transaction** Staff revalidation continues returning `committed:null` and same-nonce reconciliation when it hangs; it never claims rollback after SQL could have committed.

The actual **EOD** route now bounds its independent **Owner AAL2** verification before any reader can be created and refuses with `approved:false`, `publicationAuthorized:false`, `providerMessagesSent:0`. The downstream dual-human signed-review read remains bounded and read-only. No official EOD signing, publication, issuance or provider messaging is enabled.

The reviewed but **hard-OFF Finance** bad-lead service now bounds its one-credit canonical SQL RPC HTTP wait (4 seconds). An unresolved, failed or malformed credit receipt returns `CREDIT_OUTCOME_UNKNOWN`; it cannot automatically retry, grant money or create a replacement assignment. The test-only compiled copy accelerates the timeout to 25ms and verifies that a hanging RPC is attempted at most once and leaves the credit outcome unknown. The locked business remedy is **exactly one LEAD credit per approved original consumed assignment**, never cash refund, monetary wallet credit or automatic lead replacement.

Actual compiled native Core route/handler, Finance service and EOD route negative tests are included in the protected workflow, alongside TypeScript, live authority hard-OFF proofs and real disposable PostgreSQL 17 Core/Finance/EOD jobs. CI is **pending** on the new exact head. No protected flag changed.

**External gates remain:** QuickFurno Staging lacks required VOX Staff membership/team relations and reviewed Core/Finance/EOD SQL RPCs; one recorded managed migration lacks original SQL statement retention. The independent DBA/AppSec SQL adjudication, complete isolated Auth/Vault/Storage/roles/PostGIS/PITR restore, genuine Owner + distinct Team Leader MFA, Staff UAT and approved Staging/rollback must pass before managed installation or Production.
