/**
 * QuickFurno premium logo mark — a luxury "seal/medallion": a fine champagne-gold
 * seal ring framing an elegant monoline gold "Q" monogram on a deep emerald tile,
 * with a subtle metallic sheen, top crest dot and refined tail terminal.
 * Self-contained SVG so it renders identically on any background at zero cost.
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
          <stop offset="0" stopColor="#15735a" />
          <stop offset="1" stopColor="#06352a" />
        </linearGradient>
        <linearGradient id="qfGold" x1="0" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#f6e3a0" />
          <stop offset="0.45" stopColor="#e6c65a" />
          <stop offset="1" stopColor="#b5871d" />
        </linearGradient>
        <radialGradient id="qfVig" cx="32%" cy="24%" r="85%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="58%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.3" />
        </radialGradient>
      </defs>

      <rect width="48" height="48" rx="14" fill="url(#qfTile)" />
      <rect width="48" height="48" rx="14" fill="url(#qfVig)" />

      {/* fine seal ring (medallion) */}
      <circle cx="24" cy="24" r="17.4" fill="none" stroke="url(#qfGold)" strokeWidth="1" opacity="0.55" />
      {/* crest dot at 12 o'clock */}
      <circle cx="24" cy="6.6" r="1.15" fill="url(#qfGold)" />

      {/* elegant monoline Q */}
      <circle cx="23.2" cy="22.8" r="8.4" fill="none" stroke="url(#qfGold)" strokeWidth="2.9" />
      {/* sheen highlight on the ring */}
      <path
        d="M17.5 18.6 A8.4 8.4 0 0 1 25 15"
        fill="none"
        stroke="#fbeec2"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity="0.7"
      />
      {/* refined tail + terminal */}
      <path d="M27.8 27.4 L33 32.6" stroke="url(#qfGold)" strokeWidth="2.9" strokeLinecap="round" />
      <circle cx="33.5" cy="33.1" r="1.85" fill="#f6e3a0" />
    </svg>
  );
}
