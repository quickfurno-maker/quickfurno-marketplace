"use client";

import { useEffect, useRef, useState } from "react";

type Stat = {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  label: string;
};

const stats: Stat[] = [
  { value: 4, prefix: "Free ", suffix: " quotes", label: "Per enquiry" },
  { value: 15, suffix: " min", label: "Avg vendor response" },
  { value: 4.8, decimals: 1, suffix: "★", label: "Average client rating" },
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
  const [progress, setProgress] = useState(0); // 0 -> 1

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced || !("IntersectionObserver" in window)) {
      setProgress(1);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          const duration = 1300;
          const start = performance.now();
          const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            // easeOutCubic
            setProgress(1 - Math.pow(1 - t, 3));
            if (t < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="stats-band" ref={ref}>
      {stats.map((stat) => (
        <div className="stat-cell" key={stat.label}>
          <strong>
            {stat.prefix}
            {format(stat.value * progress, stat.decimals)}
            {stat.suffix}
          </strong>
          <span>{stat.label}</span>
        </div>
      ))}
    </div>
  );
}
