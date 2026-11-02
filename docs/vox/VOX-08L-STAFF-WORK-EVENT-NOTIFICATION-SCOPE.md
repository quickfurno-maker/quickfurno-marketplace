# VOX-08L — Staff notification inbox and read receipt (source-only)
16 October 2026. DRAFT source plus isolated QA; **NO live activation**.

## Why not reuse existing notification identity
Core already includes admin_notifications, vendor_notifications and client_notification_logs. Those correspond to distinct Owner, vendor or customer principal contexts. A Staff user has ONE neutral Supabase Auth identity with separately scoped Core team/city/department/object grants, so Staff work-event inbox records must remain distinct from all three; no second Auth, SMS/WhatsApp or agent send mechanism.

## New verified source-only artifact
- Separate reviewed SQL candidate `ops/vox/sql-candidates/20261016030000_vox08l_staff_work_notifications_candidate.sql` (not in `supabase/migrations`), added after VOX Staff foundation, reviewed departments, atomic work, EOD and chat.
- Append-only Core event origin `vox_work_events_candidate_v1`, unique per (recipient,event), supports idempotent one-time insertion; no freeform content, phone, address, customer/vendor or message bodies. Recipient's current neutral Staff membership, exact team/city, current Core source-object grant and verified canonical prospect/vendor/dual-support ownership are all rechecked by a single server-only service-role SQL helper.
- In-app notification is an **existing event reference**, not a notification delivery receipt for an external channel. This candidate installs NO event trigger, cron, provider worker or auto-fanout. A separately approved Core transaction/worker integration must call the enqueue RPC after a successful persisted Core transition. It may not invent work events.
- Immutable event tuple + read state 0→1, nonce idempotent; read receipt mutation only through service-role SQL RPC with currently authorized recipient. No delete, no cross-recipient visibility, no direct browser writes, and RLS FORCE.
- Core default-OFF `GET/POST /api/vox/v1/staff-notifications` verifies existing Supabase Auth/AAL2 with `getVerifiedScopedStaff`. GET uses SQL current-scope inbox RPC, strict 25-row cap with 26th sentinel and `totalKnown=false`, `unreadTotalKnown=false`. No claims of push delivery. POST allows only notification ID, one-use UUID nonce and revision 0. Unsupported verbs 405; no customer/vendor or provider messages.
- Protected flags: `VOX_STAFF_GRANTS_ENABLED`, `VOX_DEPARTMENT_ENFORCEMENT_ENABLED`, `VOX_STAFF_WORK_NOTIFICATIONS_ENABLED` must ALL explicitly equal `staging`; current managed environments are OFF. No automated behavior authorized.

## Actual isolated JARVIS checks
- Verified owner Staging backup SHA256 `D88176856CDBEDE5FD31216E6217A388D64A95D137C728A0CB0DE0A605BDE71E` restored in network-none PostgreSQL17, zero published ports. Prior six SQL candidates PLUS new seventh notifications SQL all installed cleanly. **15 VOX public tables**, original **86 history entries unchanged**, all disposable containers removed. Actual PostgreSQL DO security assertions PASS for forced RLS, absent anon/authenticated table privileges, four service-role-only notifier functions, forged actor/inbox/receipt denials, no mutation.
- Actual Core GET/POST source executed through isolated transpiled TypeScript VM with synthetic Auth and stubbed SQL: 11/11 adversarial tests PASS, incl no invented push receipt, invalid nonce, wrong actor, overbounded results, forged fields and disabled routes. **NOT a genuine Supabase AAL2 authenticated live test**.
- Full current Core VOX source regression 189/189 PASS and TypeScript PASS (when completed). PR-only CI must be independently observed.
- Local offline proof generated under `D:\QuickFurno-Workspace\Artifacts\VOX-08L-20261016-Isolated-Notifications.json`, hash verification recorded in release packet.

## Remaining strict gates and functional limits
- **No automatic generation, durable worker polling, unread push, email/SMS/WhatsApp or mobile alerts are built here**. A source-only 25-row in-app inbox and read receipt are built, not full notification delivery. One read receipt is not proof the employee saw/read content beyond clicking.
- No GDPR/DPDP retention or deletion scheme approved; append-only event metadata requires data-lifecycle decision and audited purge capability before production.
- Current source can independently verify both actor and Core grants; no real human credentials, signed first TL, or stage tables. DBA must review exact source history/roles/ACL and single grant chain; security must validate object/city IDOR/CSRF/Supabase AAL2, trust bootstrap, action replays and SOX-like approvals as appropriate.
- Must prove actual Core atomic work event-to-inbox enqueue and failure/queue retry semantics before claiming functional notifications. Full Core/Jarvis/AOS/AGNI plus Riya/Anisha/Aarohi channel coordination must respect consent and human handover; not certified.
- Underlying VOX-08J, 08K drafts remain unmerged. All protected staging and production changes remain HOLD.

**Current GO/NO-GO: safe isolated source work can be reviewed. Cannot release, grant privileges, create Staff, certify end-to-end or claim any external delivery.**

## Security-hardening follow-up — exact independently approved department chain
Before source certification, `qf_vox_staff_notification_scope_v1` was tightened to also demand the **current approved department grant chain** (capability, request, independent Team Leader decision, activation, live reviewer/nominee scope and non-revoked expiration), matching existing governed partial EOD. Having a Staff object scope alone is insufficient when the department grant has been revoked. This does not bypass human bootstrap or grant a capability.
The COMPLETE seven-file reviewed source sequence was rerun against a NEW disposable `--network none` PostgreSQL17 restore of the exact same verified Staging backup. All 7 files PASS, all prior 08J and 08L actual negative SQL checks PASS, 15 VOX tables, original 86 migration-history entries unchanged and disposable container removed. Latest isolated certificate SHA256 `AB82C6355288B1440B0A387081411F0AFE5E13976747D9729FFB1D51721F86FE`, saved on JARVIS as `D:\QuickFurno-Workspace\Artifacts\VOX-08L-20261016-Department-Scope-Verified.json`. This supersedes the earlier pre-hardening offline certificate for this SQL candidate. No live Staging/Prod writes or human approval.
