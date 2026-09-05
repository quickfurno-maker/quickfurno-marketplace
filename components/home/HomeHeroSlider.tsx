"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { QFIcon } from "@/components/QuickFurnoIcons";

/**
 * Homepage hero slider — exactly three slides.
 *
 * Slide copy and media are declared in ONE data array so a future premium
 * artwork pass can swap `media` (and only `media`) without touching layout:
 * the media sits in an absolutely-positioned container behind the copy and is
 * sized by the slider's own fixed track height, so no slide is coupled to a
 * particular asset's intrinsic dimensions.
 *
 * Media are LOCAL repository assets. No remote image, no video, no carousel
 * dependency — this is a small focused client component.
 *
 * QF-UI-V2-15: the three slides now use purpose-drawn architectural artwork
 * (hero-01/02/03) instead of the previous set, which was two copies of one
 * thumbnail template — captions baked into the artwork — plus a cartoon
 * diorama, all still on the retired copper palette. The new files are original
 * abstract vector art on the approved V2 tokens. They remain decorative
 * (alt="" behind aria-hidden), so swapping in final photography later is a
 * one-line change per slide with no layout or a11y consequence.
 */
/**
 * QF-MVP-80.16A — the hero is an INFORMATIONAL carousel, not a CTA surface.
 * `primary` / `secondary` were removed deliberately: conversion already has
 * consistent entry points in the header, the sticky mobile CTA, the service
 * launcher directly below the hero, and the final CTA section. Do not add an
 * action back here; the UI guard fails the build if these fields return.
 */
type HeroSlide = {
  id: string;
  headline: string;
  support: string;
  media: string;
  alt: string;
};

const SLIDES: HeroSlide[] = [
  {
    id: "core",
    headline: "Find the right verified team for your home project.",
    support:
      "Get matched with up to 3 relevant verified local teams in Pune & Mumbai — free for homeowners.",
    media: "/assets/quickfurno/images/hero/hero-01-matching.svg",
    alt: "",
  },
  {
    id: "interiors",
    headline: "From custom carpentry to modular work, find the right team.",
    support:
      "Compare verified carpenters and modular specialists across Pune & Mumbai.",
    media: "/assets/quickfurno/images/hero/hero-02-carpentry.svg",
    alt: "",
  },
  {
    id: "improvement",
    headline: "Tell us what you need and we will find relevant verified vendors.",
    support:
      "One enquiry covers interiors, carpentry, painting and civil work — your details stay private.",
    media: "/assets/quickfurno/images/hero/hero-03-multiservice.svg",
    alt: "",
  },
];

const INTERVAL_MS = 6000;

export function HomeHeroSlider() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const regionRef = useRef<HTMLDivElement | null>(null);
  const touchX = useRef<number | null>(null);

  const go = useCallback((next: number) => {
    setIndex(((next % SLIDES.length) + SLIDES.length) % SLIDES.length);
  }, []);

  // Auto-advance. Stops entirely when the visitor has asked for reduced motion,
  // and pauses while the slider is hovered, focused or being touched.
  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, go]);

  return (
    <div
      className="qf-hero-slider"
      ref={regionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label="QuickFurno highlights"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={(event) => {
        touchX.current = event.touches[0]?.clientX ?? null;
        setPaused(true);
      }}
      onTouchEnd={(event) => {
        const start = touchX.current;
        touchX.current = null;
        setPaused(false);
        if (start == null) return;
        const delta = (event.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(delta) > 45) go(index + (delta < 0 ? 1 : -1));
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); go(index + 1); }
        if (event.key === "ArrowLeft") { event.preventDefault(); go(index - 1); }
      }}
    >
      {SLIDES.map((slide, i) => {
        const active = i === index;
        // The first slide carries the page's single H1; the others are H2 so
        // the heading order stays valid whichever slide is showing.
        const Heading = i === 0 ? "h1" : "h2";
        return (
          <div
            key={slide.id}
            className="qf-hero-slide"
            data-active={active ? "true" : undefined}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${SLIDES.length}`}
            aria-hidden={active ? undefined : true}
            // Everything in an inactive slide is removed from the tab order.
            {...(active ? {} : { inert: "" as unknown as boolean })}
          >
            <div className="qf-hero-slide-media" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element -- local illustration, sized by the slider track rather than its intrinsic box. */}
              <img src={slide.media} alt={slide.alt} loading={i === 0 ? "eager" : "lazy"} />
            </div>

            <div className="qf-hero-slide-copy">
              <Heading>{slide.headline}</Heading>
              <p>{slide.support}</p>
            </div>
          </div>
        );
      })}

      <div className="qf-hero-dots" role="tablist" aria-label="Choose slide">
        {SLIDES.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            className="qf-hero-dot"
            aria-selected={i === index}
            aria-label={`Slide ${i + 1}: ${slide.headline}`}
            onClick={() => go(i)}
          />
        ))}
      </div>

      <div className="qf-hero-arrows">
        <button
          type="button"
          className="qf-hero-arrow qf-hero-arrow--prev"
          aria-label="Previous slide"
          onClick={() => go(index - 1)}
        >
          <QFIcon name="arrow" />
        </button>
        <button
          type="button"
          className="qf-hero-arrow"
          aria-label="Next slide"
          onClick={() => go(index + 1)}
        >
          <QFIcon name="arrow" />
        </button>
      </div>
    </div>
  );
}
