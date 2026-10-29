// ============================================================================
// VOX P0-1 — fixture test double for "@supabase/supabase-js", used ONLY by the
// synthetic authenticated-200 harness (vox-owner-overview-auth200.harness.mjs).
//
// This file is NEVER imported by production code. It is injected in place of the
// real @supabase/supabase-js package by the harness's ESM loader, so the REAL
// route.ts and REAL verifiedStaffBearer.ts execute unchanged against synthetic,
// in-memory fixture data. There is NO authentication bypass: the real bearer
// logic (JWT shape, remote getUser, AAL2 claim check, admin+Superadmin checks)
// all run; we only substitute the network boundary with deterministic fixtures.
// ============================================================================

// Recording of every query the route builds, for the schema-contract assertions.
export const QUERY_LOG = [];

// Synthetic identity the fixture "Auth server" will return for the good token.
export const SYNTHETIC_OWNER = Object.freeze({
  id: "f00dbabe-0000-4000-8000-00000000ab01",
  app_metadata: Object.freeze({ admin_role: "Superadmin" }),
});

// Deterministic fixture rows per table. priority is present on support rows.
const FIXTURE_ROWS = {
  aarohi_prospects: [
    { id: "f00dbabe-0000-4000-8000-0000000000a1", business_name: "Synthetic Prospect A", prospect_stage: "QUALIFYING", priority_band: "HIGH", last_activity_at: "2026-10-28T10:00:00.000Z" },
  ],
  vendor_crm_profiles: [
    { vendor_id: "f00dbabe-0000-4000-8000-0000000000b1", onboarding_stage: "DOCS", relationship_status: "ACTIVE", next_follow_up_at: "2026-10-30T10:00:00.000Z" },
  ],
  vendor_support_threads: [
    { id: "f00dbabe-0000-4000-8000-0000000000c1", vendor_id: "f00dbabe-0000-4000-8000-0000000000b1", status: "open", priority: "normal", updated_at: "2026-10-28T09:00:00.000Z" },
  ],
  communication_conversations: [
    { id: "f00dbabe-0000-4000-8000-0000000000d1", subject_type: "vendor", state: "HUMAN", human_takeover: true, revision: 3, updated_at: "2026-10-28T08:00:00.000Z" },
  ],
};

function makeDataBuilder(table) {
  const record = { table, select: null, order: null, filters: [], limit: null };
  QUERY_LOG.push(record);
  const builder = {
    select(cols) { record.select = cols; return builder; },
    eq(column, value) { record.filters.push({ column, value }); return builder; },
    order(column, opts) { record.order = { column, ascending: opts?.ascending === true }; return builder; },
    limit(n) {
      record.limit = n;
      // Resolve like PostgREST: a thenable returning { data, error }.
      return Promise.resolve({ data: (FIXTURE_ROWS[table] ?? []).slice(0, n), error: null });
    },
  };
  return builder;
}

function makeProfilesBuilder() {
  const builder = {
    select() { return builder; },
    eq() { return builder; },
    maybeSingle() { return Promise.resolve({ data: { role: "admin", is_active: true }, error: null }); },
  };
  return builder;
}

// Mimics the two createClient shapes the code uses: adminClient() (service role,
// used for .from(...) reads and the profiles lookup) and the anon client used
// inside verifySupabaseBearerUser for auth.getUser(token).
export function createClient(_url, _key, _opts) {
  return {
    from(table) {
      if (table === "profiles") return makeProfilesBuilder();
      return makeDataBuilder(table);
    },
    auth: {
      async getUser(token) {
        // The real verifiedStaffBearer only calls this AFTER JWT-shape validation.
        // Good synthetic token carries sub === SYNTHETIC_OWNER.id in its payload.
        try {
          const payload = JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
          if (payload && payload.sub === SYNTHETIC_OWNER.id) {
            return { data: { user: SYNTHETIC_OWNER }, error: null };
          }
        } catch { /* fall through to unauthenticated */ }
        return { data: { user: null }, error: { message: "fixture: unknown token" } };
      },
    },
  };
}

// @supabase/ssr is imported (but not used on this path) by lib/supabase.ts.
export function createServerClient() {
  return { auth: { async getUser() { return { data: { user: null }, error: null }; } } };
}
