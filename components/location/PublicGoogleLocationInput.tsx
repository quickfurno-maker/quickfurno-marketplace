"use client";

import { useEffect, useState } from "react";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { useActiveCities } from "@/lib/locations/useActiveCities";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";
import { useProjectLocation } from "@/components/location/ProjectLocationProvider";
import { projectLocationToGooglePlace } from "@/lib/locations/projectLocation";

export type PublicGoogleLocationInputProps = {
  city: string;
  id?: string;
  className?: string;
  placeholder?: string;
  ariaLabel?: string;
};

/**
 * Shared public lead-entry location field.
 *
 * It keeps manual typing as a fallback, but when a Google place is selected it
 * exposes the structured identity on data-* attributes. EnquiryModalTrigger
 * reads those attributes at click time, so homepage/category bars can hand the
 * exact place id + coordinates into the canonical enquiry form without inventing
 * a second location state system.
 */
export function PublicGoogleLocationInput({
  city,
  id,
  className,
  placeholder = "Search building, society, street or area",
  ariaLabel = "Project location",
}: PublicGoogleLocationInputProps) {
  const [value, setValue] = useState("");
  const [place, setPlace] = useState<NormalizedGooglePlace | null>(null);
  const [selectionError, setSelectionError] = useState("");
  const { records } = useActiveCities();
  const { location, setGoogleLocation, clearLocation } = useProjectLocation();

  // Every public project-location input reflects the same verified Google place,
  // including when the user switches to another admin-enabled city.
  useEffect(() => {
    if (!location) return;
    setValue(location.label);
    setPlace(projectLocationToGooglePlace(location));
  }, [location]);

  const selectedCityRecord = place
    ? records.find((record) =>
        isPlaceCompatibleWithSelectedCity(
          place,
          record.name,
          record.acceptedCityLabels?.length ? record.acceptedCityLabels : [record.name],
        ),
      )
    : null;

  function handleManualChange(raw: string) {
    setValue(raw);
    setPlace(null);
    setSelectionError("");
    // A manual edit is not verified Google evidence. Drop any previously saved
    // precise project point immediately so stale coordinates cannot survive.
    if (location) clearLocation({ refresh: true });
  }

  function handlePlaceSelected(next: NormalizedGooglePlace) {
    const cityRecord = records.find((record) =>
      isPlaceCompatibleWithSelectedCity(
        next,
        record.name,
        record.acceptedCityLabels?.length ? record.acceptedCityLabels : [record.name],
      ),
    );
    if (!cityRecord) {
      // A Google result gives us enough truth to know this location is outside
      // the current marketplace. Do not degrade that known mismatch into a
      // manual Pune/active-city lead.
      setPlace(null);
      setValue("");
      setSelectionError(
        `QuickFurno isn't serving ${next.city?.trim() || "that city"} yet — choose an active city location.`,
      );
      if (location) clearLocation({ refresh: true });
      return;
    }
    setSelectionError("");
    setPlace(next);
    setValue(next.area ?? next.formattedAddress ?? value);
    setGoogleLocation(next, cityRecord, { refresh: true });
  }

  return (
    <GooglePlaceAutocomplete
      id={id}
      className={className}
      value={value}
      city={location?.city ?? city}
      mode="address"
      suggestionsPortal
      placeholder={selectionError || placeholder}
      aria-label={ariaLabel}
      aria-invalid={selectionError ? true : undefined}
      autoComplete="off"
      onManualChange={handleManualChange}
      onPlaceSelected={handlePlaceSelected}
      data-quote-area=""
      data-quote-city={selectedCityRecord?.name ?? location?.city ?? city}
      data-quote-place-id={place?.placeId ?? undefined}
      data-quote-google-city={place?.city ?? undefined}
      data-quote-formatted-address={place?.formattedAddress ?? undefined}
      data-quote-area-normalized={place?.areaNormalized ?? undefined}
      data-quote-sublocality={place?.sublocality ?? undefined}
      data-quote-neighborhood={place?.neighborhood ?? undefined}
      data-quote-lat={place?.lat ?? undefined}
      data-quote-lng={place?.lng ?? undefined}
      data-quote-location-source={place ? "google_place" : "manual"}
    />
  );
}
