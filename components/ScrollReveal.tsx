"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Lightweight scroll-reveal controller.
 *
 * - Adds `reveal-enabled` to <html> so the hide-then-reveal CSS only applies when
 *   JS is running. Without JS (or if this fails) all content stays fully visible.
 * - Reveals any `[data-reveal]` / `[data-reveal-group]` element when it scrolls into view.
 * - Re-scans on every route change so client-side navigations reveal the new page.
 * - Respects `prefers-reduced-motion` by revealing everything immediately.
 *
 * No external dependencies; uses the native IntersectionObserver.
 */
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    const root = document.documentElement;
    const selector = "[data-reveal], [data-reveal-group]";

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    root.classList.add("reveal-enabled");

    const revealNow = () =>
      document
        .querySelectorAll<HTMLElement>(selector)
        .forEach((el) => el.classList.add("is-visible"));

    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      revealNow();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );

    const observeAll = () => {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (!el.classList.contains("is-visible")) observer.observe(el);
      });
    };

    observeAll();
    // Re-scan shortly after navigation/hydration for late-mounting client components.
    const rescan = window.setTimeout(observeAll, 250);

    return () => {
      window.clearTimeout(rescan);
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
