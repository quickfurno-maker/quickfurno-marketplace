// ============================================================================
// QuickFurno — GET /api/public/google-maps-config
//
// Returns ONLY the browser-restricted Google Maps key used by the public
// autocomplete UI. This key is intentionally public in a browser application;
// security must come from HTTP-referrer + API restrictions in Google Cloud.
//
// The runtime lookup is deliberate. NEXT_PUBLIC_* values are normally frozen
// during `next build`; reading via bracket notation here lets self-hosted
// production recover a key supplied to the running server/PM2 process.
// ============================================================================
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function runtimeBrowserKey(): string {
  const env = process.env as Record<string, string | undefined>;
  return (
    env.GOOGLE_MAPS_BROWSER_KEY?.trim() ||
    env["NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY"]?.trim() ||
    ""
  );
}

export async function GET() {
  const browserKey = runtimeBrowserKey();

  return NextResponse.json(
    {
      ok: true,
      configured: Boolean(browserKey),
      browserKey: browserKey || null,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
