"use client";

import { useRef, useState } from "react";

type Testimonial = { quote: string; name: string; detail: string };

// Mobile = horizontal snap carousel (one card + peek); desktop keeps the grid
// (controlled entirely by CSS on `.qf-home-testimonials`). Dots only show on
// mobile and track the scroll position.
export function TestimonialsCarousel({ testimonials }: { testimonials: readonly Testimonial[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  function stepWidth(el: HTMLDivElement) {
    const a = el.children[0] as HTMLElement | undefined;
    const b = el.children[1] as HTMLElement | undefined;
    if (a && b) return b.offsetLeft - a.offsetLeft;
    return a?.offsetWidth || el.clientWidth || 1;
  }

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / stepWidth(el));
    setActive(Math.min(Math.max(idx, 0), testimonials.length - 1));
  }

  function goTo(i: number) {
    const el = scrollRef.current;
    if (!el) return;
    const child = el.children[i] as HTMLElement | undefined;
    const first = el.children[0] as HTMLElement | undefined;
    if (child && first) el.scrollTo({ left: child.offsetLeft - first.offsetLeft, behavior: "smooth" });
  }

  return (
    <>
      <div className="qf-home-testimonials" data-reveal-group ref={scrollRef} onScroll={onScroll}>
        {testimonials.map((testimonial) => (
          <article className="qf-home-testimonial-card" key={testimonial.name}>
            <div className="qf-stars" aria-label="5 out of 5 rating">
              ★★★★★
            </div>
            <p>&quot;{testimonial.quote}&quot;</p>
            <div className="qf-home-testimonial-author">
              <span aria-hidden="true">{testimonial.name.slice(0, 1)}</span>
              <div>
                <strong>{testimonial.name}</strong>
                <small>{testimonial.detail}</small>
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="qf-testimonial-dots" role="tablist" aria-label="Testimonial slides">
        {testimonials.map((testimonial, i) => (
          <button
            key={testimonial.name}
            type="button"
            className={`qf-testimonial-dot${i === active ? " is-active" : ""}`}
            aria-label={`Go to testimonial ${i + 1}`}
            aria-selected={i === active}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </>
  );
}
