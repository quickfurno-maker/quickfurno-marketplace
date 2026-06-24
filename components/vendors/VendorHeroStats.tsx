"use client";

import { useEffect, useRef, useState } from "react";
import styles from "@/app/vendors/vendors.module.css";

// Compact stats strip shown below the vendor hero visual — counters animate up
// once when the strip first scrolls into view.
const heroStats = [
  { value: "10,000+", label: "Verified Pros" },
  { value: "4.7", label: "Average Rating" },
  { value: "100%", label: "Secure & Trusted" },
];

const DURATION = 1200;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Split "10,000+" / "4.7" / "100%" into an animatable number + suffix. */
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
    return current.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  const rounded = Math.round(current);
  return grouping ? rounded.toLocaleString("en-IN") : String(rounded);
}

export function VendorHeroStats() {
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
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.heroStats} ref={ref}>
      {heroStats.map((stat) => {
        const parsed = parseStat(stat.value);
        const display = parsed.isNumeric
          ? `${formatStat(parsed.target * progress, parsed.decimals, parsed.grouping)}${parsed.suffix}`
          : stat.value;
        return (
          <div className={styles.heroStat} key={stat.label}>
            <strong>{display}</strong>
            <small>{stat.label}</small>
          </div>
        );
      })}
    </div>
  );
}
