# Phase A VOX Web — Combined Core Work read-only Staff experience

**Status: Internal source implementation and Web build only; NO live login, real staff data, staging or production deployment.**

`lib/ui04Workspace.ts` reuses the existing verified MFA session and pinned HTTPS Core origin, with an additional `VOX_UI04_WORKSPACE_UI_ENABLED=staging` gate requiring existing staff portal and scoped/dual mode. It reads the new `/api/vox/v1/ui04-workspace` and strictly verifies the exact Core envelope, owner/source, flags, 25 max items, client vs staff source/subject pairs, UUID/timestamps, and no action permissions or extra sensitive fields. Unknown keys/permissions fail closed. Response never leaks raw email, transcript, provider response or token.

`app/team/command-center/page.tsx` displays an additional bounded read-only combined window with a proper locked state. It retains existing independently scoped Staff panels, avoiding fabricated data or a new Auth store. The local development-only Mission Control and preview stay unchanged. Actual combined view is available only to current Core support or operations managers with independent client-success permissions; acquisition- or vendor-only Staff still use existing narrowly scoped workspaces.

**QA:** `node scripts/validate-phaseA-unified-web.mjs` new source checks; `npm test`, `npm run typecheck`, `npm run build` pass in an isolated worktree. Real protected staging user/session/API calls, screen-reader manual QA, workload performance and mobile UI acceptance remain NOT CERTIFIED.

**Not yet wired:** complete source priority/SLA/cursor pagination, role-specific homepage, cross-city/multi-team switching, unread push statuses. The source-only bounded view is not a full work ledger. Cursor AI reviewer deferred by owner.
