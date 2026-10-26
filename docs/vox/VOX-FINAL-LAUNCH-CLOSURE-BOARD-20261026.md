# VOX — Final Launch Closure Board (One Go/No-Go)
**26 October 2026 — QuickFurno.** This is an operational checklist and technical handoff, not permission to run a protected release. **Live VOX is currently HOLD.**

## Launch scope and two separate gates
- **Gate S: protected Staging** must prove real Owner/Staff/Team Leader authentication, row permissions, database restore, feature-by-feature integrations and rollback with external providers disabled by default.
- **Gate P: Production** requires fresh independent DBA/AppSec + Owner signatures on the *exact* certified Core/VOX Web/Jarvis/AGNI image digests, production-specific fail-safe/backup evidence and first operator-run canary.
- VOX paid finance, outbound WhatsApp/push and autonomous agents have separate opt-in activation approvals. A green source PR cannot silently enable any of them.

## Strictly prioritized remaining work
| ID | Priority | Accountable human/system | Task | Evidence/acceptance | Current |
| --- | --- | --- | --- | --- | --- |
| S01 | P0 | Core maintainer + independent AppSec | Clear exact-head combined CI and the VOX16F historical sibling integrity guard without restoring quarantined SQL | All required GitHub checks PASS on final digest; reviewer signs narrow compatibility proof | Local code fix PASS, exact GitHub pending |
| S02 | P0 | Jarvis VPS operator | Diagnose VOX public origin: DNS → Cloudflare → TLS → reverse proxy → local app/service | Root/health/login HTTP response from two external networks; signed origin config and PM2/systemd service; failclosed private paths | Public domain previously timed out; origin unknown |
| S03 | P0 | Independent DBA | Reconcile 86 historical managed migrations against exact 7 quarantined foundations + 23 candidate VOX SQL, source checksums, dependencies and AGNI SQL | Version/alias mapping, complete ACL/RLS/SECDEF diff, qualified 30-file stage approval and complete fresh stage logical+physical/platform recovery plan | 0 VOX tables in managed stage |
| S04 | P0 | DBA + Infra | Prove current managed Stage pre-backup, isolated Supabase-compatible restore (Auth/Storage/Vault/roles/ACL/PITR/rollback), write isolation | Current snapshot hash + staging matching object counts + restore transcript + rollback drill + reviewer receipt | Historical offline restore PASS, current complete recovery pending |
| S05 | P0 | Owner + identity reviewer | Genuine existing Core Owner AAL2 enrollment, lost-device recovery, first distinct Team Leader AAL2 governed bootstrap | Auth `mfa_factors` recorded, real verified AAL2 JWT/auth API and independent maker-checker receipt; no second authentication system | 0 factors in managed Staging at last read |
| S06 | P0 | Independent AppSec | Review Staff vs Core Admin role, `is_admin()` and `owns_vendor(uuid)` compatibility, vendor grants, RLS policies, SECDEF and IDOR | Real authenticated Owner/TL/Staff/client/vendor cross-team/city negative tests; privilege revocation failclosed; signed report | Pending, issues #254/#256 |
| S07 | P0 | Release operator + DBA | Stand up signed **protected Staging only** Core + VOX Web + Jarvis + AGNI, private env/secrets/ingress, with all external effects OFF | Registered exact SHA/OCI digest, staging URL + health, 39 VOX table policy matrix after approved migration, selected source and runtime AppSec GO | Not installed/deployed |
| S08 | P0 | QA + business owner | Complete authenticated end-to-end per feature below (positive + negative) and one controlled rollback | Trace IDs/HTTP status, sealed test identities, exact grants, incident report, evidence links in Notion | Source/local only |
| S09 | P0 | Owner + reviewer + release operator | Sign stage certification and a separate production deployment decision | Exact digests + reviewer signatures + support/oncall + stop switches + recovery + owner GO | HOLD |
| P01 | P1 | Operations + AppSec | Enable internal governed Staff write actions by exact flag and department/city scope | Real approved, traceable, revocation-safe transaction; no external provider | HOLD |
| P02 | P1 | Messaging operator + AppSec | Enable consented Jarvis Riya/Anisha/Aarohi outbound, WhatsApp/push, opt-out and signed handovers separately | Actual registered provider TEST delivery/receipt + consent, quiet hours, replay and kill switch | HOLD |
| P03 | P1 | Finance owner + independent reviewer | VOX Finance history, Razorpay TEST and LIVE payment permissions | Separate protected PAY approvals, current reconciliation/credits/accounting; LIVE go separate | HOLD |
| P04 | P1 | Owner + monitoring | Bounded real Production staff canary, then gradual module rollout | Incident stop switch, health, audit-log retention, oncall and signed results | HOLD |

## Feature-by-feature real Staging acceptance matrix
Each module needs at least one **genuine authorized positive**, one **wrong-role/foreign-team/foreign-city negative**, revoked-AAL2/permission recheck, and audit/rollback evidence:
1. Owner command center, signed status/health, operational navigation
2. Owner login, MFA enrollment/recovery, Owner/Superadmin one identity
3. Staff directory, departments, granular grants, invitations, suspend/reactivate
4. Team Leader two-person approval and first bootstrap
5. Assignment/work queue/atomic transitions, object grant and duplicate safety
6. Staff/team chat and internal notification persistence/delivery
7. Aarohi acquisition CRM, prospect attribution, governed internal follow-up
8. Vendor 360 and Anisha vendor operations; no Core owner role escalation
9. Service Desk tickets/tasks and internal support handover
10. Riya client cases, human takeover, signed dual consent/acknowledgement
11. Staff EOD four-source evidence, reviews, official signed publication
12. Automation Studio simulation before separately governed internal one-shot
13. AOS advisory, model-source freshness, read-only health
14. AGNI incident/projection signed transport, replay and lost-key denial
15. VOX Finance ledger/history isolated from live Razorpay
16. WhatsApp/push providers separately in sandbox, opt-out, delivery receipts
17. Reassignment, identity revocation, concurrent sessions and recovery after restart
18. Cross-city, cross-department, inactive vendor and anonymous actor rejection

## Safe deployment order
1. Only after S01–S06 approvals: take stage snapshot and restore/rollback evidence, then **only DBA-approved** SQL version migration to **isolated protected Staging**.
2. Apply signed Core/Jarvis/VOX Web/AGNI build in stage with all senders and autonomous workers explicitly OFF.
3. Enable Owner + read-only Staff/Riya/CRM/Vendor 360/Service Desk/AOS/AGNI views ONE feature at a time after the role JWT negative matrix is green.
4. Enable governed internal writes/team queues/notifications/EOD only after Team Leader maker-checker approval, current AAL2 and exact expected revision.
5. Enable providers, EOD official publication, finance and automation only through individually signed change control and sandbox receipts.
6. Exercise failover/rollback under load, rotate approved staging secrets if needed, finalize evidence; **separate Owner production GO**. Never infer production permission from green CI.

## Named deployment blockers
- [Core VOX migration reconciliation #246](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/246)
- [Security RLS/owner-risk #254](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/254)
- [Staff/Core Admin and vendor privilege isolation #256](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/256)
- [Protected Staging signed release and environment #258](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/258)
- [Distinct first TL/Owner MFA #273](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/273)
- [Main TEST ledger cleanup #413](https://github.com/quickfurno-maker/quickfurno-marketplace/issues/413), separate Production marketplace concern

**Hard default:** all `VOX_*` feature toggles, provider workers, LIVE Razorpay, real marketplace matching, identity/Admin elevation, managed SQL and production deletes remain **OFF/HOLD** until accepted, independently signed gates. Never paste actual auth secrets, vendor identity documents or signing keys into Notion/GitHub/CI logs.
