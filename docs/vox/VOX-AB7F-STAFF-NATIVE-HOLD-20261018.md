# AB-7F — Real Core Staff membership/grant transaction candidate (RELEASE HOLD)

An uninstalled transactional Core SQL candidate revokes the **existing** neutral Staff membership, all corresponding department capabilities and object scopes, and emits one nonce-bound receipt. New staging-only adapter requires fresh Owner and independent TL AAL2 plus signed decision verification before calling Core RPC, and strictly verifies its receipt.

No Auth session provider logout, GoTrue revocation, invitation or actual live Staff mutation occurs. Existing account/session semantics and target roster revision must be checked against actual managed schema before installation. Any DB schema/trigger discrepancy is a P0 stop. Independent DBA/AppSec review and protected stage testing mandatory. No merge or deployment.
