import Image from "next/image";

const gradients = [
  "linear-gradient(135deg, #0e5a47, #07382c)",
  "linear-gradient(135deg, #c9a227, #8f6f12)",
  "linear-gradient(135deg, #126b76, #073b43)",
  "linear-gradient(135deg, #8b5a2b, #2f4b4b)",
  "linear-gradient(135deg, #6a716d, #142d36)",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "QF";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hashIndex(name: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % mod;
}

/**
 * Profile avatar with a graceful fallback: if the vendor has uploaded an image
 * it is shown (optimised via next/image), otherwise a clean initials avatar with
 * a deterministic brand-coloured gradient is generated from the name.
 */
export function Avatar({
  name,
  src,
  className = "",
}: {
  name: string;
  src?: string;
  className?: string;
}) {
  if (src) {
    return (
      <span className={`qf-avatar ${className}`}>
        <Image src={src} alt={`${name} logo`} fill sizes="56px" className="qf-avatar-img" />
      </span>
    );
  }

  return (
    <span
      className={`qf-avatar qf-avatar--initials ${className}`}
      style={{ backgroundImage: gradients[hashIndex(name, gradients.length)] }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
