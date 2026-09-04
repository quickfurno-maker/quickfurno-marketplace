// ============================================================================
// QuickFurno — client enquiry DISPLAY helpers  (QF-UI-V2-08R)
//
// PURE and DEPENDENCY-FREE (no "@/" alias, no React) so the MVP suite loader
// can import it directly.
//
// DISPLAY ONLY. Nothing here reads, writes or reshapes a submitted value:
// targetVendorCategory, targetVendorSubcategory, serviceRequired, leadIntent and
// assignment routing all keep their stored values untouched. These helpers only
// decide what the locked-context card SHOWS.
// ============================================================================

/**
 * Join a service category and subcategory for the locked-context card.
 *
 * A preferred vendor's canonical category and its first canonical service often
 * resolve to the SAME label, which rendered as "Service: Carpenters / Carpenters".
 * Equal labels (after trim + case-insensitive compare) collapse to one; genuinely
 * different labels are both kept, in the original order and format.
 *
 * The first non-empty label wins when the two match but differ in case or
 * spacing, so the vendor's own casing is what the client sees.
 */
export function formatServiceLabels(
  primary: string | null | undefined,
  secondary: string | null | undefined,
  separator = " / ",
): string {
  const labels: string[] = [];
  for (const raw of [primary, secondary]) {
    const label = typeof raw === "string" ? raw.trim() : "";
    if (!label) continue;
    const alreadyShown = labels.some((seen) => seen.toLowerCase() === label.toLowerCase());
    if (!alreadyShown) labels.push(label);
  }
  return labels.join(separator);
}

/**
 * Budget input placeholders.
 *
 * These are EXAMPLES, never values: the fields stay empty until the client types,
 * so nothing here can reach the payload. They read as examples ("e.g. 50,000")
 * rather than bare numbers, which looked like real entered amounts — especially
 * once the minimum field turned red while "50000" was still on screen.
 *
 * This is not budget guidance: no recommended range, no market benchmark and no
 * service rate is implied.
 */
export const BUDGET_MIN_PLACEHOLDER = "e.g. 50,000";
export const BUDGET_MAX_PLACEHOLDER = "e.g. 3,00,000";

/** Discard-confirmation copy, stated specifically rather than as "Are you sure?". */
export const DISCARD_CONFIRM_TITLE = "Discard this enquiry?";
export const DISCARD_CONFIRM_BODY = "Your entered details will be lost.";
