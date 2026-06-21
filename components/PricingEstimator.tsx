"use client";

import { useMemo, useState } from "react";
import { categories, pricingMatrix, type QualityLevel, type QuickFurnoCategory } from "@/lib/quickfurno-data";

const qualityLevels: QualityLevel[] = ["Budget", "Standard", "Premium"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function PricingEstimator() {
  const [category, setCategory] = useState<QuickFurnoCategory>("Interior Designers");
  const [area, setArea] = useState("650");
  const [quality, setQuality] = useState<QualityLevel>("Standard");

  const estimate = useMemo(() => {
    if (category === "Sofa") {
      return "Sofa work depends on fabric, frame, foam quality and seating size. Submit a requirement for custom pricing.";
    }

    const sqft = Number(area);
    if (!Number.isFinite(sqft) || sqft <= 0) {
      return "Enter area in sq.ft to see an estimate.";
    }

    const baseRate = pricingMatrix[category][quality];
    const low = sqft * baseRate;
    const high = Math.round(low * 1.18);

    return `${formatCurrency(low)} – ${formatCurrency(high)}`;
  }, [area, category, quality]);

  return (
    <div className="estimate-card reveal-card">
      <div>
        <span className="eyebrow">Pricing estimate</span>
        <h2>Get a quick budget range before you speak to vendors.</h2>
        <p>
          This calculator uses dummy MVP pricing. Final quotation depends on material, site condition and scope.
        </p>
      </div>

      <div className="estimate-form">
        <label>
          <span>Service Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as QuickFurnoCategory)}>
            {categories.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Area in sq.ft</span>
          <input value={area} onChange={(event) => setArea(event.target.value)} inputMode="numeric" />
        </label>

        <label>
          <span>Quality Level</span>
          <select value={quality} onChange={(event) => setQuality(event.target.value as QualityLevel)}>
            {qualityLevels.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="estimate-result">
        <span>Estimated range</span>
        <strong>{estimate}</strong>
      </div>
    </div>
  );
}
