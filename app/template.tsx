/**
 * App Router template — re-mounts on every navigation, so the CSS enter
 * animation replays on each page change, giving smooth app-like route
 * transitions. Uses opacity only (no transform/filter) so it never creates a
 * containing block that would break the sticky header or fixed mobile CTA.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="route-transition">{children}</div>;
}
