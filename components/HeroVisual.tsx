import Image from "next/image";
import { heroImage } from "@/lib/images";

const matchRows = [
  { label: "Interior studio", meta: "Premium interiors", score: "4.8" },
  { label: "Modular factory", meta: "Kitchen and wardrobe", score: "4.7" },
  { label: "Carpentry expert", meta: "Custom storage", score: "4.6" },
];

export function HeroVisual() {
  return (
    <div className="hero-visual hero-visual--premium">
      <div className="hero-photo-frame hero-float-slow">
        <Image
          src={heroImage}
          alt="Premium home interior delivered by QuickFurno verified vendors in Pune and Mumbai"
          fill
          priority
          sizes="(max-width: 980px) 100vw, 520px"
          className="hero-photo"
        />
        <span className="hero-photo-shade" aria-hidden="true" />

        <div className="hero-photo-badge hero-photo-badge--verified">
          <span aria-hidden="true">OK</span>
          Verified vendors only
        </div>

        <div className="hero-photo-card">
          <div className="hpc-rating">
            <strong>4</strong>
            <span>matches</span>
          </div>
          <div className="hpc-text">
            <strong>Shortlist in 24 hours</strong>
            <span>No spam. No resold leads.</span>
          </div>
        </div>
      </div>

      <aside className="hero-match-card" aria-label="QuickFurno matching preview">
        <div className="hero-match-head">
          <span>Requirement preview</span>
          <strong>2BHK kitchen, wardrobe and painting</strong>
        </div>
        <div className="hero-match-meter" aria-hidden="true">
          <span />
        </div>
        <div className="hero-match-list">
          {matchRows.map((row) => (
            <div className="hero-match-row" key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <span>{row.meta}</span>
              </div>
              <em>{row.score}</em>
            </div>
          ))}
        </div>
        <div className="hero-match-footer">
          <span>Matched by city, category, rate and response quality</span>
        </div>
      </aside>
    </div>
  );
}
