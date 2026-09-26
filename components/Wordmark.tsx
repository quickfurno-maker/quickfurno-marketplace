import Image from "next/image";

// =============================================================================
// The QuickFurno wordmark.
//
// One component for every placement — header, footer, anywhere else — so the
// mark can never drift between surfaces. That drift is exactly what the header
// used to work around: it rendered a CSS text wordmark rather than the logo,
// because the logo file it had was an older mark with different lettering.
//
// The registered-trade-mark sign sits at the top right of the mark, per the
// brand direction. It is decorative to a screen reader: the link that wraps
// this already announces "QuickFurno".
//
// Two files, one artwork: dark lettering for light backgrounds, white
// lettering for dark ones. The source is 660 x 107, so callers pass a height
// and the width follows.
// =============================================================================

const SRC_DARK = "/assets/quickfurno/logos/qf-wordmark.webp";
const SRC_LIGHT = "/assets/quickfurno/logos/qf-wordmark-light.webp";
const SRC_W = 660;
const SRC_H = 107;

export function Wordmark({
  height = 26,
  light = false,
  priority = false,
}: {
  height?: number;
  light?: boolean;
  priority?: boolean;
}) {
  const width = Math.round((height * SRC_W) / SRC_H);
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "flex-start",
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      <Image
        src={light ? SRC_LIGHT : SRC_DARK}
        alt="QuickFurno"
        width={SRC_W}
        height={SRC_H}
        sizes={`${width}px`}
        priority={priority}
        style={{ height, width, display: "block" }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "calc(100% - 1px)",
          top: -Math.max(1, Math.round(height * 0.04)),
          fontSize: Math.max(6.5, Math.round(height * 0.28 * 10) / 10),
          lineHeight: 1,
          fontWeight: 700,
          color: "#E0611E",
        }}
      >
        &#174;
      </span>
    </span>
  );
}
