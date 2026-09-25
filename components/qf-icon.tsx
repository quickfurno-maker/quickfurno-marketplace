// =============================================================================
// The line-icon set used across the public surfaces, drawn from the approved
// canvas boards. One component, sized and coloured from CSS so a caller never
// has to pass pixel values.
// =============================================================================

import { GLYPHS } from "@/lib/qf-glyphs";

export function Icon({
  name,
  className = "qv-ico",
  sw = 1.9,
  fill = "none",
}: {
  name: string;
  className?: string;
  sw?: number;
  fill?: string;
}) {
  const d = GLYPHS[name];
  if (!d) return null;
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={fill}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: d }}
    />
  );
}
