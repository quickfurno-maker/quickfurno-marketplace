// QuickFurno — superadmin-only Core vendor location backfill.
//
// This service is deliberately separate from Vendor CRM: CRM may DISPLAY Core
// facts but must never write the vendors table. A backfill is accepted only
// from a real Google selection carrying a Place ID + coordinate pair + Google
// city evidence. The server re-checks city compatibility and service-zone
// resolution before replacing the canonical vendor office point.
import "server-only";

import { adminClient } from "@/lib/supabase";
import { appError, fail, ok, type Result } from "@/lib/errors";
import { normalizeCoordinate } from "@/lib/geo/canonicalCoordinate";
import { getActiveCities } from "@/lib/locations/cityService";
import { verifyLocationForServiceArea } from "@/services/locationVerificationService";
import { recordAuditLog } from "@/services/adminService";

export type VendorLocationBackfillInput = {
  google_place_id: string;
  google_city: string;
  formatted_address: string;
  area_normalized?: string | null;
  sublocality?: string | null;
  neighborhood?: string | null;
  latitude: number;
  longitude: number;
};

export type VendorLocationBackfillResult = {
  vendorId: string;
  serviceZoneId: string;
  verificationStatus: "provisional" | "verified";
  verificationMethod: "city_fallback" | "polygon";
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  if (!out || out.length > max) return null;
  return out;
}

function same(value: unknown, expected: string): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === expected.trim().toLowerCase();
}

// Independently verify every admin-selected office Place ID. Browser coordinates
// and the submitted city are NOT evidence of the Google Place itself.
async function readGoogleOffice(placeId: string) {
  const key = process.env.GOOGLE_MAPS_PLACES_SERVER_KEY?.trim();
  if (!key || !/^[A-Za-z0-9_-]{8,300}$/.test(placeId)) throw appError("VALIDATION");
  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents" },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw appError("VALIDATION");
  const result = await response.json() as {
    id?: string;
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: Array<{ longText?: string; types?: string[] }>;
  };
  const point = normalizeCoordinate(result.location?.latitude, result.location?.longitude);
  const address = text(result.formattedAddress, 1000);
  const parts = Array.isArray(result.addressComponents) ? result.addressComponents : [];
  const labels = parts.filter((part) => part.types?.some((t) =>
    ["locality", "postal_town", "administrative_area_level_3", "administrative_area_level_2"].includes(t)))
    .map((part) => text(part.longText, 200)).filter((part): part is string => Boolean(part));
  if (result.id !== placeId || !point || !address || labels.length === 0) throw appError("VALIDATION");
  const fromGoogle = (kind: string) => text(parts.find((part) => part.types?.includes(kind))?.longText, 200);
  const sublocality = fromGoogle("sublocality_level_1") ?? fromGoogle("sublocality");
  return {
    point, address, labels, sublocality,
    areaNormalized: sublocality?.toLowerCase() ?? fromGoogle("locality")?.toLowerCase() ?? null,
    neighborhood: fromGoogle("neighborhood"),
  };
}

export async function backfillVendorExactLocation(
  vendorId: string,
  input: VendorLocationBackfillInput,
  actorUserId: string,
): Promise<Result<VendorLocationBackfillResult>> {
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vendorId)) {
      throw appError("VALIDATION");
    }
    if (!actorUserId) throw appError("UNAUTHORIZED");

    const placeId = text(input.google_place_id, 500);
    const googleCity = text(input.google_city, 200);
    const formattedAddress = text(input.formatted_address, 1000);
    const browserPoint = normalizeCoordinate(input.latitude, input.longitude);
    if (!placeId || !googleCity || !formattedAddress || !browserPoint) throw appError("VALIDATION");
    const googlePlace = await readGoogleOffice(placeId);
    const point = googlePlace.point;
    // A forged UI Place ID paired with a different address/point must fail closed.
    if (Math.abs(browserPoint.latitude - point.latitude) > 0.0005 ||
        Math.abs(browserPoint.longitude - point.longitude) > 0.0005) throw appError("VALIDATION");

    const db = adminClient();
    const { data: vendor, error: vendorError } = await db
      .from("vendors")
      .select("id,business_name,city,office_city,location_verification_status,service_zone_id")
      .eq("id", vendorId)
      .maybeSingle();
    if (vendorError) throw vendorError;
    if (!vendor) throw appError("VALIDATION");

    const vendorCity = text(vendor.city, 200) ?? text(vendor.office_city, 200);
    if (!vendorCity) throw appError("VALIDATION");

    const activeCities = await getActiveCities();
    const market = activeCities.find(
      (city) => same(vendorCity, city.name) || same(vendorCity, city.slug ?? ""),
    );
    if (!market) throw appError("OUTSIDE_SERVICE_AREA");

    // Trust Google-returned city components, NOT the submitted form's google_city.
    const accepted = market.acceptedCityLabels.length ? market.acceptedCityLabels : [market.name];
    const verifiedGoogleCity = googlePlace.labels.find((label) => accepted.some((city) => same(label, city)));
    if (!verifiedGoogleCity || !accepted.some((city) => same(googleCity, city))) {
      throw appError("OUTSIDE_SERVICE_AREA");
    }

    const verification = await verifyLocationForServiceArea({
      latitude: point.latitude,
      longitude: point.longitude,
      googleCity: verifiedGoogleCity,
    });

    if (
      !verification.serviceZoneId ||
      (verification.status !== "provisional" && verification.status !== "verified") ||
      (verification.method !== "city_fallback" && verification.method !== "polygon")
    ) {
      if (verification.status === "outside_service_area") throw appError("OUTSIDE_SERVICE_AREA");
      throw appError("VALIDATION");
    }

    // The resolver must agree with the market selected by the vendor's Core city.
    if (market.serviceZoneId && verification.serviceZoneId !== market.serviceZoneId) {
      throw appError("OUTSIDE_SERVICE_AREA");
    }

    const verifiedAt = verification.verifiedAt ?? new Date().toISOString();
    const { error: updateError } = await db
      .from("vendors")
      .update({
        office_latitude: point.latitude,
        office_longitude: point.longitude,
        google_place_id: placeId,
        google_city: verifiedGoogleCity,
        formatted_address: googlePlace.address,
        // Persist only metadata resolved independently from the Place ID.
        area_normalized: googlePlace.areaNormalized,
        sublocality: googlePlace.sublocality,
        neighborhood: googlePlace.neighborhood,
        service_zone_id: verification.serviceZoneId,
        location_verification_status: verification.status,
        location_verification_method: verification.method,
        location_verified_at: verifiedAt,
      })
      .eq("id", vendorId);
    if (updateError) throw updateError;

    await recordAuditLog(
      "vendor.location_backfilled",
      "vendor",
      vendorId,
      {
        previous_verification_status: vendor.location_verification_status ?? null,
        previous_service_zone_id: vendor.service_zone_id ?? null,
        verification_status: verification.status,
        verification_method: verification.method,
        service_zone_id: verification.serviceZoneId,
        source: "google_place",
      },
      actorUserId,
    );

    return ok({
      vendorId,
      serviceZoneId: verification.serviceZoneId,
      verificationStatus: verification.status,
      verificationMethod: verification.method,
    });
  } catch (error) {
    return fail(error);
  }
}
