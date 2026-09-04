import { permanentRedirect } from "next/navigation";

/**
 * Legacy nested carpenter route → canonical category page.
 *
 * QF-UI-V2-09: this path used to render its own hardcoded vendor listing — six
 * invented businesses with fabricated ratings and review counts, per-sq-ft
 * prices, quality/subscription badges, a commercial priority rank and
 * quality-based filters. None of it came from the database, so a live public URL
 * was presenting fiction as real QuickFurno marketplace data, which is exactly
 * what QF-UI-V2-06 removed everywhere else. The listing and its stylesheet are
 * deleted rather than restyled, so none of that content ships at all.
 *
 * Old links and bookmarks are preserved with a 308 permanent redirect, which
 * also consolidates the obsolete path onto the canonical page for SEO instead
 * of leaving two URLs competing for the same query. The canonical route
 * (/category/[slug]) is untouched and still serves real, visibility-filtered
 * Supabase vendors.
 */
export default function LegacyCarpentersRedirectPage() {
  permanentRedirect("/category/carpenters");
}
