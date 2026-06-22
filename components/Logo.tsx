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
          <stop offset="0" stopColor="#8FA382" />
          <stop offset="1" stopColor="#566848" />
        </linearGradient>
      </defs>

      {/* Sage tile */}
      <rect width="48" height="48" rx="15" fill="url(#qfTile)" />
      <rect x="3.5" y="3.5" width="41" height="41" rx="12" fill="none" stroke="#FFFFFF" strokeOpacity="0.3" strokeWidth="1.1" />

      {/* Arched doorway = the "Q" bowl */}
      <path
        d="M15.5 38.5 V23 a8.5 8.5 0 0 1 17 0 V38.5"
        fill="#F6F3EA"
        stroke="#33402A"
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Floor / threshold line */}
      <path d="M13.5 38.5 H34.5" stroke="#33402A" strokeWidth="2.2" strokeLinecap="round" />

      {/* Window mullion detail */}
      <path d="M24 38.5 V18.5" stroke="#33402A" strokeOpacity="0.26" strokeWidth="1.5" />
      <path d="M16.5 27 H31.5" stroke="#33402A" strokeOpacity="0.18" strokeWidth="1.3" />

      {/* Terracotta keystone at the arch apex */}
      <path d="M24 11.6 l3.2 4.6 h-6.4 z" fill="#E07A4E" />

      {/* Terracotta Q-tail crossing the base */}
      <path d="M27 35 L34.5 42.5" stroke="#E07A4E" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
