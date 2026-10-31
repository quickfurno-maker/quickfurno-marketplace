# VOX RC5 Track A — Transaction-locked consent revalidation

**30 October 2026 — SOURCE IMPLEMENTED / MANAGED RELEASE HOLD.** Based on RC4 protected PR #448 at immutable `1abd71fa1a2d747abba00840766ae13f3af1169a`.

## Actual code change
`contracts/vox/rc4ConversationAuthorization.mjs` now makes `authorizeConsentUnderLock` a mandatory transaction adapter method. After destination/conversation/Staff locks and a checked consent-event fence, but **before consuming a nonce or inserting a source row**, it repeats the trusted D2-C transactional consent decision for exactly the bound destination hash, WhatsApp channel, transactional scope, subject and conversation. Missing, unavailable, denied, marketing-scope, malformed or client-decorated outcomes trigger rollback and write no row. A thrown authority error also rolls back.

This closes a contract hole: the prior implementation could accept an unchanged event fence even when the canonical Core authority would now deny the request. The new check must be serviced by a genuine database-transaction-compatible Core authority. Passing an earlier TypeScript promise or untrusted request payload is forbidden. The race is still possible if actual consent writers do not serialize on the same destination lock. **RC4_CONVERSATION_GATE remains hard-off in production**, and the AB7B SQL CHECK/trigger blocking CORE_CONVERSATION remains unchanged.

## QA evidence
Local `node --test scripts/mvp/vox/rc4-conversation-authorization.test.mjs`: **17/17 PASS**. New test covers post-precheck deny, marketing scope, malformed allow, missing outcome and authority failure, asserting zero nonce and row writes and exact rollback. Existing tests continue covering actor revocation, wrong team/city, forged consent, replay and race documentation.

## Further required
Approve the exact Staff role/capability and team/city resolution; implement and review the real same-transaction Core consent writer and D2-C/D2-D destination-lock serialization. Only then review gate and schema removal of hard-off controls, run genuine Owner/Staff AAL2 + PostgreSQL/Auth HTTP E2E, obtain independent qualified human AppSec/DBA signoff and authorized Staging-only migration. No managed SQL was applied.
