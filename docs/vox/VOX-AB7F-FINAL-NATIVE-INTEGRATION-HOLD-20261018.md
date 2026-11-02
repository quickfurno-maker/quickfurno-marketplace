# VOX AB-7F genuine native source integration — RELEASE HOLD

**Baseline:** independently source-certified Core draft [AB-8 #361](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/361) exact head `30ea5cb8b9acdd48bf9bf4260bc9b5aeb40d9439`.

**Changes integrated from four independent worktrees:**
- [Conversation #365](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/365): native `communication_conversations` + `communication_conversation_events` plus nonce receipt **one SQL transaction**; PAUSE_AI or TAKEOVER only, no provider send or resume. Existing split Core command handler NOT redirected to this candidate until independent review, actual signed Jarvis proof/current AAL2/consent and database migration are certified.
- [Staff #362](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/362): one SQL transaction revokes existing neutral Staff membership, active department capabilities and object scopes, immutable nonce receipt. Requires current distinct Owner+TL AAL2 signed decision at trusted Core ingress. **No GoTrue Auth session termination**; real account suspension certification pending.
- [EOD #363](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/363): four canonical Core original source snapshot checks, closed IST business date, source digest, distinct current Team Leader, one staff/day uniqueness. Stores only a **pending Owner-release report** (`published=false`) after externally verified signatures; no live official publication.
- [Worker #364](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/364): bounded **single** internally approved Core queue cycle via existing atomic claim/process/fail interfaces; sanitized read-only AGNI metrics, no scheduler or external provider delivery.

**Continuous QA evidence:**
- Four focused Node adapter suites **12/12 PASS**; combined Core source suite **436/436 PASS**.
- `npm run typecheck` PASS and `npm run build` PASS in fresh npm-installed combined worktree.
- New **ninth** offline isolated `postgres:17-alpine` SQL suite executes all 3 genuine Core candidate functions; verifies atomic conversation event+revision+nonce, real Staff revocations, four-source EOD checksum/nonce, replay, wrong role, anonymous RPC and **forced native event insertion failure completely rolling back conversation state with no orphan nonce**.
- Current exact-head GitHub CI must be verified separately, never inferred from local tests. Prior AB-8 8 offline suites and locked Web tests remain in integrated workflow.

**STOP gates:** All SQL is under `ops/vox/sql-candidates` and NOT installed into Supabase migrations. No managed staging or production SQL, no real Staff Auth/MFA, no Jarvis operator ingress switch, no provider message, no actual official EOD or worker activation. Independent DBA/AppSec/Cursor review, first genuine Team Leader, JWT/AAL2 and signed M2M proof, approved release manifest/rollback, protected Staging end-to-end and Owner GO are required. Release HOLD; no merge or deploy.
