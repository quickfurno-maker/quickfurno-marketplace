/**
 * QuickFurno brand ambassador — a stylised flat-illustration portrait of an
 * Indian woman in a saree, drawn as inline SVG so it stays crisp at any size,
 * adds no network weight, and matches the emerald + champagne brand palette.
 */
export function SareeAmbassador({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 320 360"
      preserveAspectRatio="xMidYMin slice"
      role="img"
      aria-label="QuickFurno brand ambassador — an Indian woman in a saree"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="amb-saree" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0e5a47" />
          <stop offset="1" stopColor="#083b2e" />
        </linearGradient>
        <linearGradient id="amb-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6c65a" />
          <stop offset="1" stopColor="#c9a227" />
        </linearGradient>
        <radialGradient id="amb-bg" cx="50%" cy="32%" r="75%">
          <stop offset="0" stopColor="#fbf3e3" />
          <stop offset="0.55" stopColor="#f1e6d2" />
          <stop offset="1" stopColor="#e6d7bd" />
        </radialGradient>
      </defs>

      {/* studio backdrop */}
      <rect width="320" height="360" fill="url(#amb-bg)" />
      <circle cx="160" cy="150" r="118" fill="#ffffff" opacity="0.35" />

      {/* back hair */}
      <path
        d="M101 138 Q95 60 160 54 Q225 60 219 138 L217 232 Q214 286 188 312 L132 312 Q106 286 103 232 Z"
        fill="#241712"
      />

      {/* torso / saree */}
      <path d="M58 360 Q60 286 120 262 L200 262 Q260 286 262 360 Z" fill="url(#amb-saree)" />
      {/* blouse at neckline */}
      <path d="M122 264 Q160 250 198 264 L206 300 Q160 288 114 300 Z" fill="url(#amb-gold)" />

      {/* pallu draped over shoulder with gold zari border */}
      <path d="M196 262 L264 360 L214 360 L160 300 Z" fill="#0a4537" />
      <path d="M196 262 L160 300" stroke="url(#amb-gold)" strokeWidth="7" strokeLinecap="round" />
      <path d="M210 286 L246 360" stroke="url(#amb-gold)" strokeWidth="4" strokeLinecap="round" opacity="0.85" />

      {/* neck */}
      <path d="M142 222 L178 222 L181 270 Q160 280 139 270 Z" fill="#e3ab80" />
      <path d="M142 232 Q160 250 178 232 L178 226 L142 226 Z" fill="#d2966c" opacity="0.55" />

      {/* necklace */}
      <path d="M136 262 Q160 290 184 262" fill="none" stroke="url(#amb-gold)" strokeWidth="4.5" />
      <circle cx="160" cy="284" r="4.5" fill="url(#amb-gold)" />

      {/* hair lock over shoulder */}
      <path d="M118 224 Q98 280 112 332 Q124 296 126 256 Z" fill="#1d130e" />

      {/* ears */}
      <ellipse cx="110" cy="166" rx="9" ry="13" fill="#e3ab80" />
      <ellipse cx="210" cy="166" rx="9" ry="13" fill="#e3ab80" />

      {/* face */}
      <path
        d="M112 150 Q110 94 160 92 Q210 94 208 150 Q208 198 184 220 Q160 236 136 220 Q112 198 112 150 Z"
        fill="#e8b486"
      />
      {/* soft cheek blush */}
      <ellipse cx="133" cy="180" rx="10" ry="6.5" fill="#e29572" opacity="0.45" />
      <ellipse cx="187" cy="180" rx="10" ry="6.5" fill="#e29572" opacity="0.45" />
      {/* jaw shading */}
      <path d="M136 214 Q160 230 184 214 Q172 226 160 226 Q148 226 136 214 Z" fill="#d2966c" opacity="0.4" />

      {/* eyebrows */}
      <path d="M132 152 Q143 145 155 151" fill="none" stroke="#2a1a12" strokeWidth="3" strokeLinecap="round" />
      <path d="M165 151 Q177 145 188 152" fill="none" stroke="#2a1a12" strokeWidth="3" strokeLinecap="round" />

      {/* eyes with kajal */}
      <path d="M131 164 Q143 156 155 164 Q143 171 131 164 Z" fill="#ffffff" />
      <path d="M165 164 Q177 156 189 164 Q177 171 165 164 Z" fill="#ffffff" />
      <circle cx="143" cy="164" r="3.6" fill="#3a241a" />
      <circle cx="177" cy="164" r="3.6" fill="#3a241a" />
      <circle cx="144.4" cy="162.6" r="1.1" fill="#ffffff" />
      <circle cx="178.4" cy="162.6" r="1.1" fill="#ffffff" />
      <path d="M130 164 Q142 154 156 163" fill="none" stroke="#2a1a12" strokeWidth="2" strokeLinecap="round" />
      <path d="M164 163 Q178 154 190 164" fill="none" stroke="#2a1a12" strokeWidth="2" strokeLinecap="round" />

      {/* nose */}
      <path d="M160 168 L155 186 Q160 190 165 186" fill="none" stroke="#d2966c" strokeWidth="2.4" strokeLinecap="round" />
      {/* nose ring */}
      <circle cx="151" cy="186" r="2.4" fill="none" stroke="url(#amb-gold)" strokeWidth="1.6" />

      {/* lips */}
      <path d="M148 196 Q160 191 172 196 Q166 200 160 200 Q154 200 148 196 Z" fill="#c2604f" />
      <path d="M148 196 Q160 205 172 196 Q160 202 148 196 Z" fill="#a94a3c" />

      {/* front hair framing the forehead with centre parting */}
      <path
        d="M112 150 Q108 90 160 86 Q212 90 208 150 Q208 120 186 108 Q176 126 160 126 Q144 126 134 108 Q112 120 112 150 Z"
        fill="#241712"
      />
      <path d="M160 90 Q166 104 160 124" fill="none" stroke="#3a2418" strokeWidth="1.5" opacity="0.7" />

      {/* maang tikka + bindi */}
      <path d="M160 92 L160 112" stroke="url(#amb-gold)" strokeWidth="2.4" />
      <circle cx="160" cy="92" r="3.2" fill="url(#amb-gold)" />
      <circle cx="160" cy="118" r="3.4" fill="#b42318" />

      {/* jhumka earrings */}
      <g>
        <circle cx="110" cy="180" r="3.4" fill="url(#amb-gold)" />
        <path d="M110 183 L110 191" stroke="url(#amb-gold)" strokeWidth="2.6" />
        <path d="M104 196 Q110 188 116 196 Q110 200 104 196 Z" fill="url(#amb-gold)" />
        <circle cx="210" cy="180" r="3.4" fill="url(#amb-gold)" />
        <path d="M210 183 L210 191" stroke="url(#amb-gold)" strokeWidth="2.6" />
        <path d="M204 196 Q210 188 216 196 Q210 200 204 196 Z" fill="url(#amb-gold)" />
      </g>
    </svg>
  );
}
