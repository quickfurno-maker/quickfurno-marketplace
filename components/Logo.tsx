/**
 * QuickFurno logo mark — modern startup identity.
 * A bold monoline "Q" with an indigo→coral gradient stroke on a deep indigo
 * tile, finished with a coral "spark" at the tail. Self-contained SVG so it
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
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="1" stopColor="#1E1B3A" />
        </linearGradient>
        <linearGradient id="qfStroke" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#A5B4FF" />
          <stop offset="0.5" stopColor="#FF8A7A" />
          <stop offset="1" stopColor="#FF6B5A" />
        </linearGradient>
        <radialGradient id="qfVig" cx="30%" cy="22%" r="90%">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.28" />
        </radialGradient>
      </defs>

      <rect width="48" height="48" rx="14" fill="url(#qfTile)" />
      <rect width="48" height="48" rx="14" fill="url(#qfVig)" />

      {/* bold monoline Q */}
      <circle cx="22.6" cy="22.6" r="9.6" fill="none" stroke="url(#qfStroke)" strokeWidth="3.4" />
      {/* sheen highlight */}
      <path
        d="M15.6 17.4 A9.6 9.6 0 0 1 24.6 13.4"
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* tail */}
      <path d="M27.8 27.8 L32.2 32.2" stroke="url(#qfStroke)" strokeWidth="3.4" strokeLinecap="round" />

      {/* coral spark */}
      <path
        d="M34.8 30.2 C35.1 32.0 35.6 32.5 37.4 32.8 C35.6 33.1 35.1 33.6 34.8 35.4 C34.5 33.6 34.0 33.1 32.2 32.8 C34.0 32.5 34.5 32.0 34.8 30.2 Z"
        fill="#FF6B5A"
      />
    </svg>
  );
}
