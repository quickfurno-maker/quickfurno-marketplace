const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#15735a"/>
      <stop offset="1" stop-color="#06352a"/>
    </linearGradient>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4dd8e"/>
      <stop offset="0.5" stop-color="#e6c65a"/>
      <stop offset="1" stop-color="#b88a1f"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="18" fill="url(#t)"/>
  <circle cx="32" cy="32" r="23.5" fill="none" stroke="url(#g)" stroke-width="1.4" opacity="0.55"/>
  <circle cx="32" cy="9" r="1.7" fill="url(#g)"/>
  <circle cx="31" cy="30.5" r="11.4" fill="none" stroke="url(#g)" stroke-width="4"/>
  <path d="M37.2 36.7 L44.2 43.7" stroke="url(#g)" stroke-width="4" stroke-linecap="round"/>
  <circle cx="44.8" cy="44.4" r="2.5" fill="#f6e3a0"/>
</svg>`;

export function GET() {
  return new Response(favicon, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
