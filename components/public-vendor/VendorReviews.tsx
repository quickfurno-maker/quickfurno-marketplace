"use client";

import { useState, useTransition } from "react";
import { submitVendorReview } from "@/app/actions";

export type PublicReviewView = {
  id: string;
  reviewerDisplayName: string;
  rating: number;
  reviewText: string;
  createdAt: string;
  category: string | null;
  city: string | null;
};

function stars(rating: number) {
  return "★".repeat(Math.max(1, Math.min(5, Math.round(rating))));
}

function reviewDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" }).format(date);
}

export function VendorReviews({
  vendorId,
  vendorName,
  averageRating,
  reviewCount,
  reviews,
}: {
  vendorId: string;
  vendorName: string;
  averageRating: number | null;
  reviewCount: number;
  reviews: PublicReviewView[];
}) {
  const [phone, setPhone] = useState("");
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await submitVendorReview({
        vendorId,
        phone,
        rating,
        reviewText,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setPhone("");
      setRating(5);
      setReviewText("");
      setMessage({
        tone: "success",
        text: "Thanks. Your verified review was submitted for QuickFurno moderation.",
      });
    });
  }

  return (
    <section id="reviews" className="qf-vprofile-section qf-vreviews">
      <div className="qf-vreviews-heading">
        <div>
          <h2>Client reviews</h2>
          <p className="qf-vprofile-note">
            Only reviews linked to a real QuickFurno vendor assignment can be submitted.
          </p>
        </div>
        {reviewCount > 0 && averageRating !== null ? (
          <div className="qf-vreviews-summary" aria-label={`${averageRating.toFixed(1)} out of 5 from ${reviewCount} reviews`}>
            <strong>{averageRating.toFixed(1)} ★</strong>
            <span>{reviewCount} {reviewCount === 1 ? "review" : "reviews"}</span>
          </div>
        ) : null}
      </div>

      {reviews.length > 0 ? (
        <div className="qf-vreviews-list">
          {reviews.map((review) => (
            <article key={review.id} className="qf-vreview-card">
              <div className="qf-vreview-card-top">
                <div>
                  <strong>{review.reviewerDisplayName}</strong>
                  <span className="qf-vreview-stars" aria-label={`${review.rating} out of 5 stars`}>
                    {stars(review.rating)}
                  </span>
                </div>
                <time dateTime={review.createdAt}>{reviewDate(review.createdAt)}</time>
              </div>
              <p>{review.reviewText}</p>
              {review.category || review.city ? (
                <p className="qf-vprofile-note">
                  {[review.category, review.city].filter(Boolean).join(" · ")}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="qf-vreviews-empty">
          <strong>No approved reviews yet.</strong>
          <p>Be the first verified QuickFurno client to share an experience with this vendor.</p>
        </div>
      )}

      <div className="qf-vreview-form" aria-labelledby="qf-vreview-form-title">
        <div>
          <h3 id="qf-vreview-form-title">Review {vendorName}</h3>
          <p>
            Enter the same mobile number used for your QuickFurno enquiry. It is used only to verify
            the vendor interaction and is not stored in the review.
          </p>
        </div>

        <div className="qf-vreview-fields">
          <label>
            <span>Mobile number</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={10}
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="10-digit mobile number"
            />
          </label>

          <label>
            <span>Rating</span>
            <select value={rating} onChange={(event) => setRating(Number(event.target.value))}>
              <option value={5}>5 — Excellent</option>
              <option value={4}>4 — Good</option>
              <option value={3}>3 — Average</option>
              <option value={2}>2 — Below expectations</option>
              <option value={1}>1 — Poor</option>
            </select>
          </label>

          <label className="qf-vreview-text">
            <span>Your review</span>
            <textarea
              value={reviewText}
              minLength={20}
              maxLength={1000}
              rows={5}
              onChange={(event) => setReviewText(event.target.value)}
              placeholder="Describe the work, communication and your overall experience."
            />
            <small>{reviewText.length}/1000</small>
          </label>
        </div>

        {message ? (
          <p className={message.tone === "success" ? "qf-vreview-message is-success" : "qf-vreview-message is-error"} role="status">
            {message.text}
          </p>
        ) : null}

        <button
          type="button"
          className="qf-pub-btn qf-pub-btn--primary"
          disabled={pending || phone.length !== 10 || reviewText.trim().length < 20}
          onClick={submit}
        >
          {pending ? "Submitting…" : "Submit review"}
        </button>
        <p className="qf-vprofile-note">
          Reviews are published only after moderation. Rejected or hidden reviews never affect the public rating.
        </p>
      </div>
    </section>
  );
}
