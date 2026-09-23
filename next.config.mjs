/** @type {import('next').NextConfig} */

// The Supabase host is DERIVED from the same env var the client uses, never
// typed out. It was previously hard-coded as "yqpgcsduqbuxlrlzwzap.supabase.co"
// against a project whose ref is "yqpgcsduqbxulrlzwzap" — two characters
// transposed. next/image rejects any host not on this list, so every
// Supabase-hosted image would have failed with a 400 and no clue why. A typo
// here is silent, which is exactly why it should not be typed.
const supabaseHostname = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
})();

// Response security headers. The site served none at all, on any route.
//
// Content-Security-Policy is deliberately NOT here. A CSP strict enough to be
// worth having would need to account for Next's inline bootstrap scripts,
// Google Fonts and the Google Places autocomplete, and a wrong one fails by
// breaking the page silently in production. It wants its own change with
// report-only rollout first, so it is listed as work rather than guessed at.
//
// Strict-Transport-Security is also absent on purpose: it belongs at the
// edge/host (Vercel sets it), and setting it from the app can pin a header
// onto a plain-http origin during local work.
const securityHeaders = [
  // Stops a browser second-guessing a declared Content-Type. Matters most for
  // the vendor media bucket: an uploaded file must never be sniffed as html.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // No one should be able to frame the vendor or admin login and overlay it.
  { key: "X-Frame-Options", value: "DENY" },
  // A vendor profile url can identify a business; do not hand the full path to
  // whatever third party a visitor clicks through to.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing in this product uses these. Off by default is the honest setting.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), usb=(), interest-cohort=()" },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      ...(supabaseHostname
        ? [{ protocol: "https", hostname: supabaseHostname, pathname: "/storage/v1/object/public/**" }]
        : []),
    ],
  },
};
export default nextConfig;
