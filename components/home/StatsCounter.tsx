"use client";

import { useEffect, useRef, useState } from "react";
import { QFIcon } from "@/components/QuickFurnoIcons";

type IconName = Parameters<typeof QFIcon>[0]["name"];

type Stat = {
  icon: IconName;
  value: string;
  /** Full label (desktop) and a compact label (mobile). */
  label: string;
  short: string;
};

// Headline trust strip (navy strip). MVP-safe qualitative text — no fabricated
// counters. Swap to real numbers here once we have verified figures.
const homeStats: Stat[] = [
  { icon: "user", value: "Verified", label: "Teams near you", short: "Verified Teams" },
  { icon: "request", value: "Up to 3", label: "Team matches per enquiry", short: "Up to 3 Matches" },
  { icon: "tag", value: "Free", label: "Client enquiries", short: "Free Enquiry" },
  { icon: "map", value: "Pune & Mumbai", label: "Now serving", short: "Pune & Mumbai" },
  { icon: "lock", value: "Secure", label: "Data & privacy", short: "Secure & Private" },
];

const DURATION = 1200;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Split a stat value into an animatable number + suffix (or mark it static text). */
function parseStat(value: string) {
  const match = /^([\d,]+(?:\.\d+)?)(.*)$/.exec(value.trim());
  if (!match) return { isNumeric: false, target: 0, decimals: 0, suffix: "", grouping: false };
  const rawNum = match[1];
  const grouping = rawNum.includes(",");
  const decimals = rawNum.includes(".") ? rawNum.split(".")[1]?.length ?? 0 : 0;
  const target = parseFloat(rawNum.replace(/,/g, ""));
  return { isNumeric: Number.isFinite(target), target, decimals, suffix: match[2], grouping };
}

function formatStat(current: number, decimals: number, grouping: boolean) {
  if (decimals > 0) {
    return current.toLocaleString("en-IN", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  const rounded = Math.round(current);
  return grouping ? rounded.toLocaleString("en-IN") : String(rounded);
}

export function StatsCounter() {
  const ref = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const prefersReduced =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const run = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      if (prefersReduced) {
        setProgress(1);
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / DURATION, 1);
        setProgress(easeOutCubic(t));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (!("IntersectionObserver" in window)) {
      run();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            run();
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="qf-stats-section" id="stats" aria-label="QuickFurno stats">
      <div className="qf-stats-strip" ref={ref} data-reveal-group>
        {homeStats.map((stat) => {
          const parsed = parseStat(stat.value);
          const display = parsed.isNumeric
            ? `${formatStat(parsed.target * progress, parsed.decimals, parsed.grouping)}${parsed.suffix}`
            : stat.value;
          return (
            <div className="qf-stat-item" key={stat.label}>
              <span className="qf-stat-icon">
                <QFIcon name={stat.icon} />
              </span>
              <strong>{display}</strong>
              <small>
                <span className="qf-stat-label-full">{stat.label}</span>
                <span className="qf-stat-label-short" aria-hidden="true">
                  {stat.short}
                </span>
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}
