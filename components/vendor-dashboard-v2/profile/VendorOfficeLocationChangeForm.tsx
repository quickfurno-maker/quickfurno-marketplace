"use client";

import { useState } from "react";
import { vendorSubmitOfficeLocationChangeRequest } from "@/app/actions";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";
import { useActiveCities } from "@/lib/locations/useActiveCities";

export function VendorOfficeLocationChangeForm({
  city, pending,
}: {
  city: string;
  pending: boolean;
}) {
  const { records } = useActiveCities();
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<NormalizedGooglePlace | null>(null);
  const [error, setError] = useState("");
  const market = records.find((record) => record.name.toLowerCase() === city.toLowerCase());
  const active = Boolean(market);
  const ready = active && !!place?.placeId && !!place.city && !!place.formattedAddress
    && place.lat != null && place.lng != null;

  function picked(value: NormalizedGooglePlace) {
    const labels = market?.acceptedCityLabels ?? [city];
    if (!active || !isPlaceCompatibleWithSelectedCity(value, city, labels) ||
      !value.placeId || !value.city || !value.formattedAddress ||
      value.lat == null || value.lng == null) {
      setError("Choose an exact Google office address within your active QuickFurno city.");
      setPlace(null);
      return;
    }
    setPlace(value);
    setQuery(value.formattedAddress);
    setError("");
  }

  return (
    <section className="qf-vendor-v2-profile-card" aria-label="Google business office location">
      <h3>Business office location</h3>
      <p className="text-sm text-slate-600">
        Search your exact office, shop or business base using Google Places.
        This will be sent for admin review; it does not change your
        current matching point, service coverage, package or credits.
      </p>
      {pending ? (
        <p role="status" className="mt-3 text-sm text-amber-700">
          Your office-location change is awaiting admin verification.
          You can see it in the request history below.
        </p>
      ) : (
        <form action={vendorSubmitOfficeLocationChangeRequest} className="mt-4 grid gap-3">
          <label htmlFor="vendor-office-google" className="text-sm font-semibold">
            Google office address — {city || "City not configured"}
          </label>
          <GooglePlaceAutocomplete
            id="vendor-office-google"
            value={query}
            city={city}
            mode="address"
            disabled={!active}
            onManualChange={(value) => { setQuery(value); setPlace(null); setError(""); }}
            onPlaceSelected={picked}
            placeholder={active ? "Search office, shop, building or street" : "Active city required"}
          />
          <p className="text-xs text-slate-500">
            Select a Google suggestion. Typed text alone cannot verify a business location.
          </p>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          <input type="hidden" name="google_place_id" value={ready ? place?.placeId ?? "" : ""} />
          <input type="hidden" name="google_city" value={ready ? place?.city ?? "" : ""} />
          <input type="hidden" name="formatted_address" value={ready ? place?.formattedAddress ?? "" : ""} />
          <input type="hidden" name="latitude" value={ready ? String(place?.lat) : ""} />
          <input type="hidden" name="longitude" value={ready ? String(place?.lng) : ""} />
          <button type="submit" disabled={!ready} className="qf-vendor-v2-btn qf-vendor-v2-btn--primary">
            Request office location verification
          </button>
        </form>
      )}
    </section>
  );
}
