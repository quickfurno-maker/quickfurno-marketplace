"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import GooglePlaceAutocomplete from "@/components/location/GooglePlaceAutocomplete";
import { QFIcon } from "@/components/QuickFurnoIcons";
import { isPlaceCompatibleWithSelectedCity } from "@/lib/google-maps/normalizePlace";
import type { NormalizedGooglePlace } from "@/lib/google-maps/types";
import {
  PROJECT_LOCATION_COOKIE,
  PROJECT_LOCATION_COOKIE_MAX_AGE_SECONDS,
  PROJECT_LOCATION_DISMISSED_SESSION_KEY,
  PROJECT_LOCATION_STORAGE_KEY,
  makeProjectLocation,
  parseProjectLocation,
  parseProjectLocationCookie,
  projectLocationToGooglePlace,
  serializeProjectLocation,
  serializeProjectLocationCookie,
  type ProjectLocation,
} from "@/lib/locations/projectLocation";
import {
  useActiveCities,
  type ActiveCityRecord,
} from "@/lib/locations/useActiveCities";

type SetGoogleLocationOptions = {
  refresh?: boolean;
};

type ProjectLocationContextValue = {
  location: ProjectLocation | null;
  hydrated: boolean;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
  clearLocation: (options?: SetGoogleLocationOptions) => void;
  setGoogleLocation: (
    place: NormalizedGooglePlace,
    cityRecord: Pick<ActiveCityRecord, "name" | "serviceZoneId">,
    options?: SetGoogleLocationOptions,
  ) => ProjectLocation | null;
};

const ProjectLocationContext = createContext<ProjectLocationContextValue | null>(null);

function shouldAutoPrompt(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/enquiry") return true;
  if (pathname.startsWith("/category/")) return true;
  if (pathname.startsWith("/vendors/") && pathname !== "/vendors/register" && pathname !== "/vendors/dashboard") {
    return true;
  }
  return false;
}

function readCookieLocation(): ProjectLocation | null {
  if (typeof document === "undefined") return null;
  const prefix = `${PROJECT_LOCATION_COOKIE}=`;
  const row = document.cookie
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return row ? parseProjectLocationCookie(row.slice(prefix.length)) : null;
}

function persistLocation(location: ProjectLocation | null) {
  if (typeof window === "undefined") return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (location) {
    const raw = serializeProjectLocation(location);
    const serverCookie = serializeProjectLocationCookie(location);
    window.localStorage.setItem(PROJECT_LOCATION_STORAGE_KEY, raw);
    document.cookie =
      `${PROJECT_LOCATION_COOKIE}=${encodeURIComponent(serverCookie)}; Path=/; Max-Age=${PROJECT_LOCATION_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  } else {
    window.localStorage.removeItem(PROJECT_LOCATION_STORAGE_KEY);
    document.cookie =
      `${PROJECT_LOCATION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

export function ProjectLocationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { cities, records, loaded } = useActiveCities();
  const [location, setLocation] = useState<ProjectLocation | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pickerError, setPickerError] = useState("");

  useEffect(() => {
    let next: ProjectLocation | null = null;
    try {
      next = parseProjectLocation(window.localStorage.getItem(PROJECT_LOCATION_STORAGE_KEY));
    } catch {
      // Storage can be blocked. Cookie remains the server/client fallback.
    }
    if (!next) next = readCookieLocation();
    setLocation(next);
    setQuery(next?.label ?? "");
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !loaded || records.length === 0 || !location) return;
    const stillActive = records.some(
      (record) => record.name.toLowerCase() === location.city.toLowerCase(),
    );
    if (!stillActive) {
      setLocation(null);
      setQuery("");
      persistLocation(null);
    }
  }, [hydrated, loaded, records, location]);

  useEffect(() => {
    if (!hydrated || !loaded || records.length === 0 || location || !shouldAutoPrompt(pathname)) return;
    try {
      if (window.sessionStorage.getItem(PROJECT_LOCATION_DISMISSED_SESSION_KEY) === "1") return;
    } catch {
      // If sessionStorage is blocked, showing one dismissible prompt is safe.
    }
    setPickerOpen(true);
  }, [hydrated, loaded, records.length, location, pathname]);

  const openPicker = useCallback(() => {
    setPickerError("");
    setQuery(location?.label ?? "");
    setPickerOpen(true);
  }, [location]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setPickerError("");
    try {
      window.sessionStorage.setItem(PROJECT_LOCATION_DISMISSED_SESSION_KEY, "1");
    } catch {
      // Non-essential preference only.
    }
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePicker();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      root.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen, closePicker]);

  const setGoogleLocation = useCallback(
    (
      place: NormalizedGooglePlace,
      cityRecord: Pick<ActiveCityRecord, "name" | "serviceZoneId">,
      options: SetGoogleLocationOptions = {},
    ) => {
      const next = makeProjectLocation({
        place,
        city: cityRecord.name,
        serviceZoneId: cityRecord.serviceZoneId,
      });
      if (!next) return null;
      setLocation(next);
      setQuery(next.label);
      persistLocation(next);
      try {
        window.sessionStorage.removeItem(PROJECT_LOCATION_DISMISSED_SESSION_KEY);
      } catch {
        // Non-essential preference only.
      }
      if (options.refresh !== false) router.refresh();
      return next;
    },
    [router],
  );

  const clearLocation = useCallback(
    (options: SetGoogleLocationOptions = {}) => {
      setLocation(null);
      setQuery("");
      persistLocation(null);
      if (options.refresh !== false) router.refresh();
    },
    [router],
  );

  const value = useMemo<ProjectLocationContextValue>(
    () => ({
      location,
      hydrated,
      pickerOpen,
      openPicker,
      closePicker,
      clearLocation,
      setGoogleLocation,
    }),
    [location, hydrated, pickerOpen, openPicker, closePicker, clearLocation, setGoogleLocation],
  );

  function choosePlace(place: NormalizedGooglePlace) {
    if (!place.placeId || place.lat == null || place.lng == null) {
      setPickerError("Please choose a Google suggestion with a precise map location.");
      return;
    }

    const cityRecord =
      records.find((record) =>
        isPlaceCompatibleWithSelectedCity(
          place,
          record.name,
          record.acceptedCityLabels?.length ? record.acceptedCityLabels : [record.name],
        ),
      ) ??
      records.find(
        (record) =>
          place.city &&
          record.name.toLowerCase() === place.city.toLowerCase(),
      );

    if (!cityRecord) {
      const cityLabel = place.city?.trim() || "that location";
      setPickerError(
        `QuickFurno isn't serving ${cityLabel} yet. Please choose a location in an active QuickFurno city.`,
      );
      return;
    }

    const next = setGoogleLocation(place, cityRecord);
    if (!next) {
      setPickerError("We could not save that Google location. Please choose another suggestion.");
      return;
    }
    setPickerOpen(false);
    setPickerError("");
  }

  const defaultBiasCity =
    location?.city ??
    records[0]?.name ??
    cities[0] ??
    "";

  return (
    <ProjectLocationContext.Provider value={value}>
      {children}

      {pickerOpen ? (
        <div
          className="qf-project-location-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closePicker();
          }}
        >
          <section
            className="qf-project-location-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qf-project-location-title"
          >
            <button
              type="button"
              className="qf-project-location-close"
              aria-label="Close project location picker"
              onClick={closePicker}
            >
              ×
            </button>

            <span className="qf-project-location-icon" aria-hidden="true">
              <QFIcon name="pin" />
            </span>
            <h2 id="qf-project-location-title">Where do you need the service?</h2>
            <p>
              Choose the project location from Google. QuickFurno uses it to show
              relevant vendors and calculate straight-line proximity.
            </p>

            <div className="qf-project-location-field">
              <GooglePlaceAutocomplete
                value={query}
                city={defaultBiasCity || undefined}
                mode="address"
                suggestionsPortal
                placeholder="Search area, society, building or landmark"
                aria-label="Project location"
                autoComplete="off"
                onManualChange={(next) => {
                  setQuery(next);
                  setPickerError("");
                }}
                onPlaceSelected={choosePlace}
              />
            </div>

            {pickerError ? (
              <p className="qf-project-location-error" role="alert">
                {pickerError}
              </p>
            ) : null}

            {location ? (
              <div className="qf-project-location-current">
                <span>Current project location</span>
                <strong>{location.label}, {location.city}</strong>
                <button
                  type="button"
                  onClick={() => clearLocation({ refresh: true })}
                >
                  Clear
                </button>
              </div>
            ) : null}

            <small>
              Select the place where the work is actually required.
            </small>
          </section>
        </div>
      ) : null}
    </ProjectLocationContext.Provider>
  );
}

export function useProjectLocation(): ProjectLocationContextValue {
  const value = useContext(ProjectLocationContext);
  if (!value) {
    throw new Error("useProjectLocation must be used inside ProjectLocationProvider");
  }
  return value;
}

export function useProjectLocationGooglePlace(): NormalizedGooglePlace | null {
  const { location } = useProjectLocation();
  return location ? projectLocationToGooglePlace(location) : null;
}
