# VL-01 Real Auth / Core Trace Acceptance

Run `node scripts/mvp/automation/certify-vl01-real-auth-http.mjs` from the repository root.

This runs the real Core Next.js API on a loopback port against disposable PostgreSQL 16, Supabase GoTrue, PostgREST and a loopback-only HTTP gateway. It signs temporary anonymous/service-role JWTs with a random local key, creates a synthetic vendor using genuine GoTrue Auth, constructs a real @supabase/ssr cookie session, tests vendor/admin/superadmin authorization and returns actual SQL-backed job/attempt/transport evidence. No real projects, accounts, message sends, payments or production credentials are used. Containers, network and synthetic records are removed in `finally`.

**Release distinction:** This is an integrated HTTP/API authentication certificate, not a browser UI checkbox or production deployment. The source-only assignment-permission migration was applied to QuickFurno staging via Supabase's migration tool as version `20261012180214` (same audited SQL as pinned source file `20261012213000`); owner-read/service-role writes remain intact. Production migration is pending separate backed-up approval. VPS has actual green source `65c61cb...`, blue `d59bf9c...`, and signed candidate `0bb57ab...` is not deployed.

Do not reinterpret an app-server trace as proof of Meta provider delivery. Do not run the test with external Supabase environment credentials. The certificate refuses `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` in its invocation.
