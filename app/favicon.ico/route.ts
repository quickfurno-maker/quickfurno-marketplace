const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#12694f"/>
      <stop offset="1" stop-color="#063a2c"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="16" fill="url(#t)"/>
  <circle cx="29" cy="30" r="14" fill="none" stroke="#f4f1ea" stroke-width="4.6"/>
  <path d="M36 37 L47 48" stroke="#e6c65a" stroke-width="4.8" stroke-linecap="round"/>
  <circle cx="47.5" cy="48.5" r="2.4" fill="#e6c65a"/>
</svg>`;

export function GET() {
  return new Response(favicon, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
