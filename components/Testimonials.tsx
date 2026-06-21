import { clientTestimonials } from "@/lib/quickfurno-data";

export function Testimonials() {
  return (
    <div className="testimonial-grid" data-reveal-group>
      {clientTestimonials.map((testimonial) => (
        <article className="testimonial-card" key={testimonial.name}>
          <div className="stars" aria-label="5 star review">★★★★★</div>
          <p>“{testimonial.quote}”</p>
          <div className="testimonial-author">
            <span>{testimonial.name.slice(0, 1)}</span>
            <div>
              <strong>{testimonial.name}</strong>
              <small>{testimonial.detail}</small>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
