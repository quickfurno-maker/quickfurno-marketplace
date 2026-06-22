/**
 * QuickFurno logo mark — premium editorial identity.
 * A refined monoline "Q" in warm bronze on a deep espresso tile, with a subtle
 * cream sheen and a small bronze serif terminal. Self-contained SVG so it
 * renders identically on any background at zero cost.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role="img"
      aria-label="QuickFurno"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="qfTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#26201A" />
          <stop offset="1" stopColor="#171412" />
        </linearGradient>
        <linearGradient id="qfBronze" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#E2C089" />
          <stop offset="0.5" stopColor="#C9A066" />
          <stop offset="1" stopColor="#B8874A" />
        </linearGradient>
        <radialGradient id="qfVig" cx="30%" cy="22%" r="90%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.3" />
        </radialGradient>
      </defs>

      <rect width="48" height="48" rx="14" fill="url(#qfTile)" />
      <rect width="48" height="48" rx="14" fill="url(#qfVig)" />

      {/* fine bronze seal ring */}
      <circle cx="24" cy="24" r="17.2" fill="none" stroke="url(#qfBronze)" strokeWidth="0.9" opacity="0.45" />

      {/* monoline Q */}
      <circle cx="23.2" cy="22.8" r="9" fill="none" stroke="url(#qfBronze)" strokeWidth="3" />
      {/* cream sheen */}
      <path
        d="M16.4 18 A9 9 0 0 1 24.6 13.9"
        fill="none"
        stroke="#F7EFDF"
        strokeWidth="1.1"
        strokeLinecap="round"
        opacity="0.5"
      />
      {/* tail terminal */}
      <path d="M27.8 27.6 L32.6 32.4" stroke="url(#qfBronze)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="33.2" cy="33" r="1.7" fill="#E2C089" />
    </svg>
  );
}
