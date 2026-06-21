import Link from "next/link";

/**
 * Premium home-interiors marketplace visual for the hero — a glassmorphism panel
 * of verified vendor/category tiles with trust badges, plus floating trust chips.
 * Built with CSS gradient "project" thumbnails so it stays fast and on-brand
 * (drop real photos into the .hmc-thumb tiles later via next/image if desired).
 */
const categoryTiles = [
  { label: "Interior Designers", tone: "warm-suite", badge: "Verified" },
  { label: "Modular Factory", tone: "kitchen-line", badge: "Quick Matching" },
  { label: "Carpenters", tone: "wood-craft", badge: "Transparent Rates" },
  { label: "Painters", tone: "paint-finish", badge: "Free Quote" },
];

const floatingBadges = [
  { label: "Verified", icon: "✓", className: "hero-chip--1" },
  { label: "Transparent Rates", icon: "₹", className: "hero-chip--2" },
  { label: "Quick Matching", icon: "⚡", className: "hero-chip--3" },
  { label: "Free Quote", icon: "★", className: "hero-chip--4" },
];

export function HeroVisual() {
  return (
    <div className="hero-visual">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-blob hero-blob--a" aria-hidden="true" />
      <div className="hero-blob hero-blob--b" aria-hidden="true" />

      <div className="hero-market-card hero-float-slow">
        <div className="hmc-head">
          <span className="hmc-live">
            <i aria-hidden="true" /> Live marketplace
          </span>
          <strong>Verified home-service vendors</strong>
        </div>

        <div className="hmc-grid">
          {categoryTiles.map((tile) => (
            <Link href="#verified-vendors" className="hmc-tile" key={tile.label}>
              <span className={`hmc-thumb ${tile.tone}`} aria-hidden="true" />
              <span className="hmc-tile-body">
                <span className="hmc-tile-label">{tile.label}</span>
                <span className="hmc-badge">{tile.badge}</span>
              </span>
            </Link>
          ))}
        </div>

        <Link href="#verified-vendors" className="hmc-foot">
          <span className="hmc-foot-tone civil-reno" aria-hidden="true" />
          <span className="hmc-foot-text">
            <strong>Civil Work &amp; Renovation</strong>
            <span>Vetted contractors · transparent quotes</span>
          </span>
          <span className="hmc-foot-cta" aria-hidden="true">→</span>
        </Link>
      </div>

      {floatingBadges.map((badge) => (
        <span key={badge.label} className={`hero-chip ${badge.className}`} aria-hidden="true">
          <i>{badge.icon}</i>
          {badge.label}
        </span>
      ))}
    </div>
  );
}
