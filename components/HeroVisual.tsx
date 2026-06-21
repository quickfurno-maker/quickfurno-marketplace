import Image from "next/image";
import { heroImage } from "@/lib/images";

const floatingBadges = [
  { label: "100% Verified", icon: "✓", className: "hero-chip--1" },
  { label: "Transparent Rates", icon: "₹", className: "hero-chip--2" },
  { label: "Quick Matching", icon: "⚡", className: "hero-chip--3" },
  { label: "Free Quote", icon: "★", className: "hero-chip--4" },
];

/**
 * Hero visual — a premium HD interior photo (optimised + priority-loaded for LCP)
 * with glassmorphism trust overlays and floating badges to drive conversion.
 */
export function HeroVisual() {
  return (
    <div className="hero-visual">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-blob hero-blob--a" aria-hidden="true" />
      <div className="hero-blob hero-blob--b" aria-hidden="true" />

      <div className="hero-photo-frame hero-float-slow">
        <Image
          src={heroImage}
          alt="Premium home interior delivered by QuickFurno verified vendors in Pune and Mumbai"
          fill
          priority
          sizes="(max-width: 980px) 100vw, 460px"
          className="hero-photo"
        />
        <span className="hero-photo-shade" aria-hidden="true" />

        <div className="hero-photo-badge hero-photo-badge--verified">
          <i aria-hidden="true">✓</i> Verified vendors only
        </div>

        <div className="hero-photo-card">
          <div className="hpc-rating">
            <strong>4.8</strong>
            <span className="hpc-stars" aria-hidden="true">★★★★★</span>
          </div>
          <div className="hpc-text">
            <strong>Loved by homeowners</strong>
            <span>Across Pune &amp; Mumbai</span>
          </div>
        </div>

        <div className="hero-photo-pill" aria-hidden="true">
          <i>⚡</i> 4 free quotes in 24 hrs
        </div>
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
