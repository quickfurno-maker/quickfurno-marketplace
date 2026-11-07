# F18 — verified Staging SQL parity, public-directory security review and credential-rotation handoff

**7 November 2026 · Actual operational evidence · NO DEPLOY · NO SEND · Production HOLD**

## A. Real managed database SQL parity — RESOLVED (ten versions)

Read-only Supabase Staging project `uckafzuochmbvtiodmcl`, registry `supabase_migrations.schema_migrations`: recorded version, name, statement counts and SQL fingerprint hashes for all 10 November 4–6 migrations. All ten exact local source filenames at F17 committed source SHA `cb9a1919e5690f29e65da3bea6e09d4e174991b9` independently matched registered actual SQL contents:

- **Nov 4 vendor registration, verification and scan foundation — 7/7:** actual SQL statement counts **6, 45, 8, 16, 8, 6, 16** and newline-joined trimmed raw SQL MD5 exactly match local PostgreSQL-aware lexical splitter results, with source-file SHA-256 pinned.
- **Nov 6 F7 first two inactive template/binding migrations — 2/2:** registered whole SQL statement **raw bytes** compared directly to local source, **identical content and length** (4537 and 2856 bytes, respectively) and same MD5. Earlier apparent canonical mismatches arose because single DO-block SQL kept a trailing semicolon and leading newline; not real drift.
- **Nov 6 F8 inactive Riya provider account — 1/1:** registered single terminated SQL block MD5 `205643fd6da3c24ba8c5cdc147674881` matches the local whole terminated statement; source SHA-256 pinned.

**Final finding:** 10/10 source SQL content parity **PASS** as of 7 Nov 2026, with no migration applied, SQL write or server change. Artifact `qf-f18-managed-sql-ledger-proof-20261107.json` has only safe version/hash/count metadata, no SQL statements, keys, account data or OTP. Verifier `scripts/mvp/launch/f18_verify_managed_sql_parity.py` has independent hostile tests and prints a strictly **HOLD** verdict even when SQL content matches. GitHub CI rechecks local source-to-snapshot, not the live managed registry; repeat a read-only managed fingerprint check if new migrations or source versions are added.

## B. Supabase security advisor — targeted review, NOT blanket mutation

Actual Staging read-only SQL + [Supabase security advisor](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view) showed public `vendor_public_v` remains a **SECURITY DEFINER view** owned by `postgres`, SELECT intentionally granted to `anon` and `authenticated`. The underlying `public.vendors` has RLS ENABLED; anonymous direct SELECT is denied. The view exposes **exactly 21 preselected public-facing columns**; no column name matches phone/email/Aadhaar/PAN/GST/token/secret/private/address. The view filters `Approved`, `is_active=true`, `public_visibility=true`, `remaining_credits>0`.

**Important:** blindly changing the view to `security_invoker=true` would make anonymous queries lose access to `vendors`, likely **break the homepage public vendor directory**. Do not blanket REVOKE SELECT or turn the whole view to invoker. Future proper remedy is a purpose-built public projection table or reviewed limited public RLS policy with tests, preserving only the 21 safe columns, strict visibility and safe image URLs, and no user-private data. Requires authorized AppSec/product signoff. The advisor ERROR therefore remains **OPEN**, not "fixed."

Read-only SQL also confirmed `public.is_admin()` and `public.owns_vendor(uuid)` are SECURITY DEFINER STABLE functions executable by `authenticated` but **not** `anon`. They are referenced by existing RLS ownership policies. Do not revoke their authenticated EXECUTE without dependency analysis. [Advisory detail](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

## C. Credential rotation and callback operator handoff — P0, blocked on external authority

One prior diagnostic **exposed secret-valued runtime environment entries** in operational tool output, including an existing Supabase Staging service-role JWT and WhatsApp Meta bearer token. No keys are included in source, Notion, GitHub or this document. Treat both as **compromised**, never paste to chat or logs, and do not reuse the flawed names-only shell probe.

**Safe coordinated sequence:**
1. **Meta:** identify all apps/production or Staging deployments using the affected token, provision a new least-privilege system-user WhatsApp token with correct WABA access for each separate lane, store in protected vault, then update each service. Verify with read-only Graph GET using the *new* token only. Revoke old Meta bearer token and verify it is invalid. Keep Riya WABA `27861262223494153`/phone `1333595106493545` completely separate from Anisha WABA `1569174604351612`/phone `1088396637681784`, with no cross-fallback.
2. **Supabase:** use supported `sb_secret_` API keys and plan migration of all service-role consumers before revocation. **Replacing just the env key does not revoke an exposed legacy JWT**; the old service-role JWT uses the project's JWT signing secret. Plan the JWT-signing-key/legacy-key deprecation carefully because it can affect Auth sessions, existing tokens, anon/frontend clients and other applications. Do **not** blindly rotate the legacy JWT secret in a running shared environment. [Supabase API key migration](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
3. **Callbacks:** separately verify Meta App WhatsApp configured callback URL and vendor WABA subscription actual routing; Riya's earlier verified override points `https://quickfurno.in/api/webhooks/whatsapp/meta` and must not be repointed without client traffic isolation. Supabase **Staging Authentication → Hooks → Send SMS** must have its effective URL, enabled state and signing secret verified; `/api/auth/hooks/supabase-send-sms` returning 405 for GET is not registration proof.
4. **Release:** keep old Docker image+Compose+env rollback; fresh managed DB/Auth/Storage object-byte restore drill; image signature/attestation and protected F1/F5/F6/F7 integrated review. Current F17 candidate archive is on VPS root-only quarantine. **DO NOT load or deploy** it before rotation+signoff, do not enable OTP until signed live canary test is explicitly authorized.

ClamAV remains Owner-deferred; vendor approval/assignment/credit consumption dependent on private document scan must remain fail closed. **The migration content mismatch blocker is cleared; the release itself is not authorized.**
