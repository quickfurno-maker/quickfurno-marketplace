// QuickFurno launch geography policy.
// Pune is the only marketplace city until a future explicit launch migration changes this contract.
export const LAUNCH_CITY = "Pune" as const;
export const LAUNCH_CITY_SLUG = "pune" as const;
export const LAUNCH_CITIES = [LAUNCH_CITY] as const;

export type LaunchCity = (typeof LAUNCH_CITIES)[number];

function cityKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True only for the current launch city, case/whitespace insensitive. */
export function isLaunchCity(value: unknown): boolean {
  return cityKey(value) === LAUNCH_CITY_SLUG;
}

/** Canonicalise a supported city to "Pune"; unsupported input fails closed. */
export function normalizeLaunchCity(value: unknown): LaunchCity | null {
  return isLaunchCity(value) ? LAUNCH_CITY : null;
}

/** Filter arbitrary city labels to the canonical launch-city list. */
export function filterLaunchCityNames(values: readonly unknown[]): LaunchCity[] {
  return values.some(isLaunchCity) ? [LAUNCH_CITY] : [];
}
