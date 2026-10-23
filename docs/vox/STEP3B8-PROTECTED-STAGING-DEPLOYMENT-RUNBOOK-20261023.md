# VOX 3B-8D — Protected Staging release and rollback (REVIEW ONLY)
**No executable managed DB migration or server release action is authorized by this document.** Source CI success does not imply the Staging database, real Owner MFA or Production are ready.
## Boundaries
- Current reviewed source starts from 30319c2e0a465ffd33a48aba073215df9af370c9 (documentation-only source preflight); Step3B8 package must be separately built, committed, reviewed and pinned at its exact SHA.
- Source-only Docker image at qf-staging is `qf-vox-rc3-release-smoke:12eb177f`, built in production mode but running only in separate 127.0.0.1:3318 locked smoke container.
- Existing `qf-vox-rc3-private-preview` on 127.0.0.1:3317 is dev preview with real auth disabled. Do not promote either container blindly.
- **DO NOT APPLY unreviewed migrations**, unquarantine SQL, update managed migrations ledger, edit public DNS, create Superadmin role, disable MFA, or make Razorpay TEST/LIVE API calls.
## Gate A — Migration / DBA independent decision
Reconcile 104 migration version differences **semantically** across the 86-row Staging and Production ledgers; capture signed SQL version hashes, owners, security-definer funcs, triggers, data dependencies, roll-forward path, versions to apply and postflight query plan. 52/52 differing versions do not prove semantic equivalence. Rehearse global roles/ACL/DEFAULT PRIVILEGES, physical storage, auth providers, session rollback and actual PITR restore. Four-schema logical pg_dump replay is NOT full recovery proof.
## Gate B — AppSec independent decision
For each of 69 named policy IDs sign decisions including effective SQL roles, grants, permissive OR / restrictive AND composition, status guard behavior, stale JWT/session, SECURITY DEFINER, vendor own-record historical invoice/refund/support read versus revoked new-work/write/outbound capability; review 59 admin and 22 vendor helper references (12 overlapping).
## Gate C — Owner exact Staging release
Owner explicitly signs exact approved release SHA, env Staging project, image digest, verified backup, breakpoint, rollback roles and actual DBA/AppSec signatures. No autonomous grant. Existing Core Superadmin account only; no second auth system. Genuine Owner AAL2 and first Team Leader require separately controlled enrollment.
## Gate D — Staging runtime activation
Only AFTER Gates A–C: activate approved DB schema, deploy signed version-matched Core, Jarvis, AGNI and VOX Web, configure stage-only env via secret manager (never service_role), keep outward payments/messages disabled, validate private TLS Core VOX routes and all 403/401 negative auth cases. Capture actual migrations/permissions and logs. Do not substitute isolated view for verified Staff data.
## Gate E — End-to-end
Verify legitimate AAL2 Owner, Admin staff roster, scoped Staff/TL, Vendor 360, Riya, Anisha, Aarohi, AGNI and Finance with real authorized Staging test users; verify inactive/revoked vendor and Admin denials, session invalidation and authorized historical reads. Razorpay genuine TEST separately with consent and money isolation.
## Gate F — separate Production GO
After reviewed staging evidence, a **separate Production GO** requires the exact production-approved code/image digest, full current Production backup/rollback, WAF/origin/Cloudflare TLS, monitoring and alerts, explicit Owner signature and independent database/security signoff. Never reuse a Staging GO for production. Public DNS remains untouched until then.
## Rollback qualification
The earlier four-schema archive restore was tested only on an isolated PG17 clone. Do not claim that restoring it will recreate global roles, ACL, external auth sessions, object-storage binaries or PITR. Independent DBA signs a complete rollback or forward-fix plan.
