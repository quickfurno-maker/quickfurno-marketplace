# VOX-16E PG17 real SQL negative authorization

Extends the existing **seven chronological VOX migration** disposable PostgreSQL 17 test. Previously it checked `has_table_privilege()` / `has_function_privilege()` metadata. It now also performs **four actual denied SQL executions under the actual synthetic `anon` / `authenticated` database roles**: SELECT canonical staff membership and operational intent tables, and invoke restricted approval/followup functions with inert NULL IDs. All four must return `permission denied` and nonzero psql exit. No actual Core followup or provider action executes.

Local fixture passes all 7 migration files plus 4 true negative probes; container `--network none` deleted after test. This is not yet real Supabase staging RLS/Auth JWT, caller consent, cross-city IDOR or signed private Core↔Jarvis. Current managed Staging still has 0 applied VOX versions. Production HOLD.
