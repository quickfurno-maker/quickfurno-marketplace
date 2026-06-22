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
        <linearGradient id="qfTealTile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6FBF8" />
          <stop offset="1" stopColor="#E5F1EE" />
        </linearGradient>
        <linearGradient id="qfGoldRoof" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#E7B45A" />
          <stop offset="1" stopColor="#D9902F" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill="url(#qfTealTile)" />
      <rect x="4" y="4" width="40" height="40" rx="12" fill="none" stroke="#B9D4D7" strokeWidth="1.2" />
      <path d="M10 25.5 24 14l14 11.5" fill="none" stroke="#075B67" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 23.5V37h18V23.5" fill="#FFFDF8" stroke="#075B67" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M19 37v-8h6v8" fill="#F8F4EA" stroke="#075B67" strokeWidth="2" strokeLinejoin="round" />
      <path d="M28 18.2h5.2V26" fill="none" stroke="url(#qfGoldRoof)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="35.2" cy="13.4" r="2.2" fill="#D9902F" opacity="0.95" />
      <path d="M31 31h5" stroke="#D9902F" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
