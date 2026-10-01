"use client";

import { useMemo, useState } from "react";
import { vendorSubmitProfileChangeRequest } from "@/app/actions";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";
import type { VendorProfileSummary } from "@/lib/types";

const SERVICE_RADIUS_OPTIONS = [5, 10, 15, 20, 30, 50] as const;

type OfficeState = {
  display: string;
  placeId: string;
  formattedAddress: string;
  areaNormalized: string;
  sublocality: string;
  neighborhood: string;
  lat: number | null;
  lng: number | null;
  fullCity: boolean;
  radiusKm: string;
};

function initialOffice(vendor: VendorProfileSummary): OfficeState {
  return {
    display:
      vendor.formatted_address ||
      vendor.office_address_line1 ||
      vendor.areas_covered?.[0] ||
      "",
    placeId: vendor.google_place_id || "",
    formattedAddress: vendor.formatted_address || "",
    areaNormalized: vendor.area_normalized || vendor.areas_covered?.[0]?.toLowerCase() || "",
    sublocality: vendor.sublocality || "",
    neighborhood: vendor.neighborhood || "",
    lat: vendor.office_latitude,
    lng: vendor.office_longitude,
    fullCity: vendor.covers_full_city === true,
    radiusKm:
      vendor.covers_full_city === true || vendor.service_radius_km == null
        ? ""
        : String(vendor.service_radius_km),
  };
}

function signature(value: OfficeState): string {
  return JSON.stringify({
    placeId: value.placeId,
    lat: value.lat,
    lng: value.lng,
    fullCity: value.fullCity,
    radiusKm: value.fullCity ? "" : value.radiusKm,
  });
}

export function VendorOfficeLocationEditor({ vendor }: { vendor: VendorProfileSummary }) {
  const original = useMemo(() => initialOffice(vendor), [vendor]);
  const [office, setOffice] = useState<OfficeState>(original);
  const [error, setError] = useState("");

  const verified =
    Boolean(office.placeId) &&
    office.lat != null &&
    office.lng != null &&
    Number.isFinite(office.lat) &&
    Number.isFinite(office.lng);

  const validRadius =
    office.fullCity ||
    SERVICE_RADIUS_OPTIONS.includes(
      Number(office.radiusKm) as (typeof SERVICE_RADIUS_OPTIONS)[number],
    );
  const changed = signature(office) !== signature(original);
  const canSubmit = verified && validRadius && changed;

  function onManualChange(value: string) {
    setError("");
    setOffice((current) => ({
      ...current,
      display: value,
      placeId: "",
      formattedAddress: "",
      areaNormalized: value.trim().toLowerCase(),
      sublocality: "",
      neighborhood: "",
      lat: null,
      lng: null,
    }));
  }

  function onPlaceSelected(place: NormalizedGooglePlace) {
    if (vendor.city && !isPlaceCompatibleWithSelectedCity(place, vendor.city)) {
      setError(`Please select an office / business location within ${vendor.city}.`);
      return;
    }
    if (place.lat == null || place.lng == null || !place.placeId) {
      setError("That place did not return precise coordinates. Please choose another Google suggestion.");
      return;
    }

    setError("");
    setOffice((current) => ({
      ...current,
      display: place.formattedAddress || place.area || current.display,
      placeId: place.placeId || "",
      formattedAddress: place.formattedAddress || "",
      areaNormalized: place.areaNormalized || place.area?.toLowerCase() || "",
      sublocality: place.sublocality || "",
      neighborhood: place.neighborhood || "",
      lat: place.lat,
      lng: place.lng,
    }));
  }

  const currentVerified =
    Boolean(vendor.google_place_id) &&
    vendor.office_latitude != null &&
    vendor.office_longitude != null;

  return (
    <section className="qf-vendor-v2-panel qf-vendor-v2-profile-section">
      <header className="qf-vendor-v2-profile-section-head">
        <h2 className="qf-vendor-v2-panel-title">Exact office location</h2>
        <p className="qf-vendor-v2-profile-section-hint">
          Used for nearby lead matching. A location change becomes active only after QuickFurno approval.
        </p>
      </header>

      <form action={vendorSubmitProfileChangeRequest} className="qf-vendor-v2-profile-section-body">
        <label className="qf-vendor-v2-profile-field">
          <span className="qf-vendor-v2-profile-label">Office / shop / studio / workshop</span>
          <GooglePlaceAutocomplete
            value={office.display}
            city={vendor.city || undefined}
            mode="address"
            onManualChange={onManualChange}
            onPlaceSelected={onPlaceSelected}
            placeholder="Search exact office, shop, studio or building"
            autoComplete="street-address"
            className="qf-vendor-v2-profile-input"
          />
          <span className="qf-vendor-v2-profile-hint">
            {verified
              ? "Google-verified coordinates are ready for review."
              : "Select a Google suggestion. Typed text alone is not trusted for geographic matching."}
          </span>
        </label>

        {error ? (
          <p className="qf-vendor-v2-profile-hint" data-tone="error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="qf-vendor-v2-profile-location-state" data-verified={currentVerified ? "true" : "false"}>
          <strong>{currentVerified ? "Verified matching point on file" : "Precise matching point needed"}</strong>
          <span>
            {currentVerified
              ? vendor.formatted_address || vendor.office_address_line1 || "Google place stored"
              : "Your current account does not yet have a Google-verified office point."}
          </span>
        </div>

        <label className="qf-vendor-v2-profile-coverage-check">
          <input
            type="checkbox"
            checked={office.fullCity}
            onChange={(event) =>
              setOffice((current) => ({
                ...current,
                fullCity: event.target.checked,
                radiusKm: event.target.checked ? "" : current.radiusKm,
              }))
            }
          />
          <span>
            <strong>Serve entire city</strong>
            <small>Office location remains the nearby-priority anchor.</small>
          </span>
        </label>

        {!office.fullCity ? (
          <label className="qf-vendor-v2-profile-field">
            <span className="qf-vendor-v2-profile-label">Service radius from office</span>
            <select
              value={office.radiusKm}
              onChange={(event) =>
                setOffice((current) => ({ ...current, radiusKm: event.target.value }))
              }
              className="qf-vendor-v2-profile-input"
            >
              <option value="">Select service radius</option>
              {SERVICE_RADIUS_OPTIONS.map((km) => (
                <option key={km} value={String(km)}>
                  {km} km
                </option>
              ))}
            </select>
            <span className="qf-vendor-v2-profile-hint">
              Coverage controls where you accept work; it does not change your office point.
            </span>
          </label>
        ) : null}

        <input type="hidden" name="office_google_place_id" value={office.placeId} />
        <input type="hidden" name="office_formatted_address" value={office.formattedAddress} />
        <input type="hidden" name="office_latitude" value={office.lat ?? ""} />
        <input type="hidden" name="office_longitude" value={office.lng ?? ""} />
        <input type="hidden" name="office_area_normalized" value={office.areaNormalized} />
        <input type="hidden" name="office_sublocality" value={office.sublocality} />
        <input type="hidden" name="office_neighborhood" value={office.neighborhood} />
        <input type="hidden" name="office_covers_full_city" value={String(office.fullCity)} />
        <input
          type="hidden"
          name="office_service_radius_km"
          value={office.fullCity ? "" : office.radiusKm}
        />

        <div className="qf-vendor-v2-profile-location-submit">
          <button
            type="submit"
            className="qf-vendor-v2-btn qf-vendor-v2-btn--primary"
            disabled={!canSubmit}
          >
            Submit location for approval
          </button>
          <p className="qf-vendor-v2-profile-hint">
            {!verified
              ? "Select a Google suggestion first."
              : !validRadius
                ? "Select your service radius or choose full-city coverage."
                : !changed
                  ? "No location or coverage change to submit."
                  : "QuickFurno will review this before it affects matching."}
          </p>
        </div>
      </form>
    </section>
  );
}
