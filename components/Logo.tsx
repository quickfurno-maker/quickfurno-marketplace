/**
 * QuickFurno premium logo mark — a self-contained SVG so it renders identically
 * on any background (light header, dark footer, dashboards). Emerald tile with an
 * ivory "Q" ring and a champagne-gold spark tail (quality + premium craft).
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
          <stop offset="0" stopColor="#12694f" />
          <stop offset="1" stopColor="#063a2c" />
        </linearGradient>
        <linearGradient id="qfGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6c65a" />
          <stop offset="1" stopColor="#c9a227" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#qfTile)" />
      {/* soft corner highlight for depth */}
      <path d="M0 14C0 6.27 6.27 0 14 0h18C20 6 8 18 0 32z" fill="#ffffff" opacity="0.07" />
      {/* hairline gold frame for a luxe edge */}
      <rect x="3.5" y="3.5" width="41" height="41" rx="11" fill="none" stroke="url(#qfGold)" strokeWidth="1" opacity="0.28" />
      {/* Q ring */}
      <circle cx="22" cy="22" r="10.4" fill="none" stroke="#f4f1ea" strokeWidth="3.4" />
      {/* Q tail / spark in gold */}
      <path d="M27 27 L35 35" stroke="url(#qfGold)" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="35.6" cy="35.6" r="1.7" fill="#e6c65a" />
    </svg>
  );
}
