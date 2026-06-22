"use client";

import { useEffect, useRef, useState } from "react";

type Stat = {
  value: number;
  decimals?: number;
  suffix?: string;
  star?: boolean;
  label: string;
};

// Real, trust-building marketplace stats. The count-up is a pure visual
// enhancement — the final values always render even if animation never runs.
const stats: Stat[] = [
  { value: 4, label: "Free quotes per enquiry" },
  { value: 15, suffix: " min", label: "Avg vendor response" },
  { value: 4.8, decimals: 1, star: true, label: "Client rating" },
  { value: 100, suffix: "%", label: "Verified vendors" },
];

function format(value: number, decimals = 0) {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function StatsBand() {
  const ref = useRef<HTMLDivElement>(null);
  // Start fully revealed so values are NEVER stuck at 0 (the old bug). The
  // count-up only animates as an enhancement when motion is allowed.
  const [progress, setProgress] = useState(1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return; // keep final values, no animation

    let raf = 0;
    setProgress(0);
    const duration = 1200;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Safety net: guarantee final values even if rAF is throttled/interrupted.
    const failSafe = window.setTimeout(() => setProgress(1), duration + 400);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(failSafe);
    };
  }, []);

  return (
    <div className="stats-band" ref={ref}>
      {stats.map((stat) => (
        <div className="stat-cell" key={stat.label}>
          <strong>
            {format(stat.value * progress, stat.decimals)}
            {stat.star ? <span className="stat-star" aria-hidden="true">★</span> : null}
            {stat.suffix ? <span className="stat-suffix">{stat.suffix}</span> : null}
          </strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
