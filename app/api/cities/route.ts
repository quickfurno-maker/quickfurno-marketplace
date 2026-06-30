// ============================================================================
// QuickFurno — Phase 14B: GET /api/cities
// Public, read-only list of ACTIVE admin-managed cities (names only).
//
// Cities are public info (the cities table allows anon read of active rows), so
// no auth is required. Returns city names only — NO secrets, NO service-role
// key. Used by the client enquiry form, vendor registration, and admin filters
// so admin-managed active cities are the single source of truth.
// ============================================================================
import { NextResponse } from "next/server";
import { getActiveCities } from "@/lib/locations/cityService";

export const dynamic = "force-dynamic";

export async function GET() {
  const cities = await getActiveCities();
  return NextResponse.json(
    { ok: true, cities: cities.map((city) => city.name), records: cities },
    { status: 200 },
  );
}
