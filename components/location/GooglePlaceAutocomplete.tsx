"use client";

// ============================================================================
// QuickFurno — components/location/GooglePlaceAutocomplete.tsx
// Google area enhancement; manual fallback preserved.
//
// A controlled <input> that ALSO offers Google area/locality suggestions using
// the Places NEW programmatic Autocomplete Data API (AutocompleteSuggestion +
// prediction.toPlace() + place.fetchFields()), rendered in a QuickFurno-owned
// dropdown so the modal's look is unchanged. If Google is missing, blocked, or
// fails for ANY reason, this behaves exactly like a plain input — manual typing
// remains first-class and always submits.
//
// Behaviour:
//   • onManualChange fires immediately on every keystroke (fallback path).
//   • suggestions are debounced (~300ms) and only requested for >= 3 chars.
//   • one AutocompleteSessionToken per typing-to-selection session (refreshed
//     after each completed selection).
//   • a single monotonic interaction version invalidates ALL stale async results
//     — both suggestion fetches and place-detail (fetchFields) selections — so no
//     out-of-order response can overwrite newer state.
//   • keyboard: ArrowUp/Down move, Enter selects, Escape closes; Enter never
//     submits the enquiry form. Mouse select + outside-click-to-close supported.
// ============================================================================
import {
  InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { loadGoogleMaps } from "@/lib/google-maps/loadGoogleMaps";
import { normalizeGooglePlace } from "@/lib/google-maps/normalizePlace";
import type {
  AutocompleteRequest,
  NewPlace,
  NormalizedGooglePlace,
  PlacePrediction,
  PlacesLibrary,
} from "@/lib/google-maps/types";

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onSelect"
>;

export type GooglePlaceAutocompleteProps = NativeInputProps & {
  value: string;
  placeholder?: string;
  /** Currently-selected city; used to bias/normalize the picked place. */
  city?: string;
  /** Fired on every keystroke (manual typing) — the fallback path. */
  onManualChange: (value: string) => void;
  /** Fired once the user picks a Google prediction. */
  onPlaceSelected: (place: NormalizedGooglePlace) => void;
  /** "locality" biases to areas/sublocalities; "address" to full addresses. */
  mode?: "locality" | "address";
};

type Suggestion = {
  id: string;
  primary: string;
  secondary: string;
  prediction: PlacePrediction;
};

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;
const MAX_SUGGESTIONS = 6;

export default function GooglePlaceAutocomplete({
  value,
  placeholder,
  city,
  onManualChange,
  onPlaceSelected,
  mode = "locality",
  ...inputProps
}: GooglePlaceAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const placesRef = useRef<PlacesLibrary | null>(null);
  const sessionTokenRef = useRef<unknown>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Single monotonic interaction version. It is bumped on EVERY manual edit and
  // at the START of a selection. Any async result (a suggestions fetch OR a
  // place-detail fetchFields) that captured an older version is stale and must
  // NOT touch state — this defeats every out-of-order race (typing over a slow
  // request, clearing the field, or picking A then typing before A resolves).
  const interactionVersionRef = useRef(0);

  // Latest callbacks/props read by async handlers without re-subscribing.
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  // Reserved for FUTURE city-specific request biasing (locationBias). It is
  // intentionally NOT passed to normalizeGooglePlace — the selected form city must
  // never manufacture Google city evidence for the compatibility check.
  const cityRef = useRef(city);
  const modeRef = useRef(mode);
  onPlaceSelectedRef.current = onPlaceSelected;
  cityRef.current = city;
  modeRef.current = mode;

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Best-effort load of the Places library. Any failure leaves manual input intact.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((places) => {
        if (!cancelled) placesRef.current = places;
      })
      .catch(() => {
        /* never throws — manual input remains fully functional */
      });
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const ensureSessionToken = useCallback((): unknown => {
    const places = placesRef.current;
    if (!places) return null;
    if (!sessionTokenRef.current) {
      try {
        sessionTokenRef.current = new places.AutocompleteSessionToken();
      } catch {
        sessionTokenRef.current = null;
      }
    }
    return sessionTokenRef.current;
  }, []);

  const closeDropdown = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  // `version` is captured when the debounce was scheduled; if a newer interaction
  // has happened by the time we resolve, we abandon this response entirely.
  const fetchSuggestions = useCallback(async (input: string, version: number) => {
    const isCurrent = () => version === interactionVersionRef.current;
    const places = placesRef.current;
    const query = input.trim();
    if (!places || query.length < MIN_CHARS) {
      if (isCurrent()) {
        setSuggestions([]);
        closeDropdown();
      }
      return;
    }

    const baseRequest: AutocompleteRequest = {
      input: query,
      sessionToken: ensureSessionToken() ?? undefined,
      includedRegionCodes: ["in"], // India-only; no guessed city bounds
      language: "en",
      region: "IN",
      includedPrimaryTypes: modeRef.current === "address" ? ["geocode"] : ["(regions)"],
      // locationBias / locationRestriction are intentionally left unset — a clean
      // extension point for FUTURE city-specific biasing (never guessed here).
    };

    const run = (request: AutocompleteRequest) =>
      places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

    let response: Awaited<ReturnType<typeof run>> | null = null;
    try {
      response = await run(baseRequest);
    } catch {
      // Retry once without the primary-type filter (some keys reject the type).
      try {
        const { includedPrimaryTypes: _omit, ...rest } = baseRequest;
        void _omit;
        response = await run(rest);
      } catch {
        if (isCurrent()) {
          setSuggestions([]);
          closeDropdown();
        }
        return;
      }
    }

    // Drop stale responses: only the newest interaction may update the UI.
    if (!isCurrent()) return;

    const items: Suggestion[] = (response?.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is PlacePrediction => Boolean(p))
      .slice(0, MAX_SUGGESTIONS)
      .map((p, i) => ({
        id: p.placeId ?? `sugg-${i}`,
        primary: p.mainText?.text ?? p.text?.text ?? "",
        secondary: p.secondaryText?.text ?? "",
        prediction: p,
      }))
      .filter((s) => s.primary.length > 0);

    setSuggestions(items);
    setActiveIndex(items.length ? 0 : -1);
    setOpen(items.length > 0);
  }, [closeDropdown, ensureSessionToken]);

  const handleManualChange = useCallback(
    (raw: string) => {
      // Every manual edit is a new interaction: bump the version so any in-flight
      // suggestion fetch OR pending place-detail selection is invalidated.
      const version = ++interactionVersionRef.current;
      onManualChange(raw); // immediate fallback — never gated on Google
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!placesRef.current || raw.trim().length < MIN_CHARS) {
        setSuggestions([]);
        closeDropdown();
        return;
      }
      debounceRef.current = setTimeout(() => void fetchSuggestions(raw, version), DEBOUNCE_MS);
    },
    [onManualChange, fetchSuggestions, closeDropdown],
  );

  const selectSuggestion = useCallback(async (suggestion: Suggestion) => {
    // Selection is itself a new interaction: bump + capture the version, then
    // cancel any pending suggestion fetch and close the list immediately.
    const version = ++interactionVersionRef.current;
    closeDropdown();
    setSuggestions([]);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const places = placesRef.current;
    if (!places) return;
    try {
      const place: NewPlace = suggestion.prediction.toPlace();
      // fetchFields populates the Place instance in place; read it back after await.
      await place.fetchFields({
        fields: ["id", "displayName", "formattedAddress", "addressComponents", "location"],
      });
      // If the user interacted (typed a new area, cleared, picked again) while
      // fetchFields was in flight, this detail result is stale — do NOT apply it.
      if (version !== interactionVersionRef.current) return;
      const normalized = normalizeGooglePlace(place, modeRef.current);
      onPlaceSelectedRef.current(normalized);
    } catch {
      // fetchFields failed — the manually typed value stands; do nothing.
    } finally {
      // A session ends at selection: refresh the token for the next search.
      sessionTokenRef.current = null;
      ensureSessionToken();
    }
  }, [closeDropdown, ensureSessionToken]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLInputElement>) => {
      inputProps.onKeyDown?.(e);
      if (!open || suggestions.length === 0) {
        // Still stop Enter from submitting the enquiry form from this field.
        if (e.key === "Enter") e.preventDefault();
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % suggestions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < suggestions.length) {
            void selectSuggestion(suggestions[activeIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          closeDropdown();
          break;
        default:
          break;
      }
    },
    [open, suggestions, activeIndex, selectSuggestion, closeDropdown, inputProps],
  );

  // Close on outside click (mousedown so it beats input blur/select).
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(ev.target as Node)) {
        closeDropdown();
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, closeDropdown]);

  // Unique per-instance ARIA ids so multiple mounted autocompletes never collide.
  const uid = useId();
  const listboxId = `qf-place-list-${uid}`;
  const optionId = (i: number) => `qf-place-opt-${uid}-${i}`;
  const showList = open && suggestions.length > 0;

  return (
    <div className="qf-place-ac" ref={containerRef}>
      <input
        {...inputProps}
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        onChange={(e) => handleManualChange(e.target.value)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          showList && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        autoComplete={inputProps.autoComplete ?? "off"}
      />
      {showList ? (
        <ul className="qf-place-suggest" role="listbox" id={listboxId}>
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              className={`qf-place-suggest-item${i === activeIndex ? " is-active" : ""}`}
              // onMouseDown (not onClick) so selection fires before input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                void selectSuggestion(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="qf-place-suggest-main">{s.primary}</span>
              {s.secondary ? <span className="qf-place-suggest-sub">{s.secondary}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
