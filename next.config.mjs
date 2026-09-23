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

const nextConfig = {
  reactStrictMode: true,
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
