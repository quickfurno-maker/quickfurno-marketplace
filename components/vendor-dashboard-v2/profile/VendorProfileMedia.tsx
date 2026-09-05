"use client";

import { useEffect, useState } from "react";
import { VendorIcon } from "../icons";
import { PROFILE_LIMITS, isSafeMediaUrl } from "./profileModel";

/**
 * URL-based media manager.
 *
 * THERE IS NO UPLOAD BUTTON HERE ON PURPOSE. The repository has no vendor media
 * upload path — no Supabase Storage call, no signed-upload endpoint, no media
 * API route, no file input anywhere in the app. Rendering an "Upload" control
 * would be a button that cannot work, so the vendor gets an honest image-link
 * manager with real previews instead. Direct file upload needs a backend phase
 * of its own.
 *
 * `src` is only ever set from a value that passes isSafeMediaUrl(), which
 * mirrors the server's setSafeUrl(): a relative path or http(s), nothing else.
 * A `javascript:` or `data:` value can therefore never reach the DOM.
 *
 * A plain <img> is used rather than next/image because vendor image URLs come
 * from arbitrary hosts and next.config only allowlists two — the same reason,
 * and the same eslint-disable, that the public vendor profile page already uses.
 */
export function VendorProfileImageField({
  name,
  label,
  hint,
  shape,
  defaultValue,
}: {
  name: string;
  label: string;
  hint: string;
  shape: "avatar" | "cover";
  defaultValue: string;
}) {
  const [url, setUrl] = useState(defaultValue);
  const inputId = `qf-media-${name}`;
  const trimmed = url.trim();
  const safe = isSafeMediaUrl(trimmed);
  const invalid = trimmed.length > 0 && !safe;

  return (
    <div className="qf-vendor-v2-profile-media" data-shape={shape}>
      <MediaPreview src={safe ? trimmed : null} shape={shape} label={label} />

      <div className="qf-vendor-v2-profile-media-controls">
        <label className="qf-vendor-v2-profile-field">
          <span className="qf-vendor-v2-profile-label" id={`${inputId}-label`}>
            {label}
          </span>
          <input
            id={inputId}
            name={name}
            type="url"
            inputMode="url"
            value={url}
            maxLength={PROFILE_LIMITS.urlLength}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/photo.jpg"
            className="qf-vendor-v2-profile-input"
            aria-describedby={`${inputId}-hint`}
            aria-invalid={invalid || undefined}
          />
        </label>
        <p className="qf-vendor-v2-profile-hint" id={`${inputId}-hint`}>
          {invalid ? "Use a link starting with https:// or /." : hint}
        </p>
        {trimmed ? (
          <button
            type="button"
            className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
            onClick={() => setUrl("")}
          >
            Clear link
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Preview with explicit empty / loading / broken states — never a broken icon. */
function MediaPreview({
  src,
  shape,
  label,
}: {
  src: string | null;
  shape: "avatar" | "cover";
  label: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(src ? "loading" : "idle");

  useEffect(() => {
    setStatus(src ? "loading" : "idle");
  }, [src]);

  return (
    <div className="qf-vendor-v2-profile-preview" data-shape={shape} data-status={status}>
      {src && status !== "error" ? (
        // eslint-disable-next-line @next/next/no-img-element -- vendor image URLs come from arbitrary hosts; plain img avoids the next/image host allowlist, matching app/vendors/[id]/page.tsx.
        <img
          src={src}
          alt={`${label} preview`}
          loading="lazy"
          onLoad={() => setStatus("ok")}
          onError={() => setStatus("error")}
        />
      ) : null}

      {status === "idle" ? (
        <span className="qf-vendor-v2-profile-preview-empty">
          <VendorIcon name="profile" size={shape === "avatar" ? 20 : 22} />
          <span>No image yet</span>
        </span>
      ) : null}

      {status === "error" ? (
        <span className="qf-vendor-v2-profile-preview-empty" data-tone="error">
          <VendorIcon name="alert" size={shape === "avatar" ? 20 : 22} />
          <span>Could not load</span>
        </span>
      ) : null}
    </div>
  );
}

/**
 * Portfolio manager: add one link at a time, remove, reorder, max 12.
 * Order is meaningful — it is exactly the order of the serialized array, which
 * is what the server stores and the public profile renders.
 */
export function VendorProfilePortfolioField({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string[];
}) {
  const [urls, setUrls] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = urls.length >= PROFILE_LIMITS.maxPortfolio;

  function add() {
    const value = draft.trim();
    if (!value) return;
    if (!isSafeMediaUrl(value)) {
      setError("Use a link starting with https:// or /.");
      return;
    }
    if (urls.includes(value)) {
      setError("That photo is already in your portfolio.");
      return;
    }
    if (full) {
      setError(`You can add up to ${PROFILE_LIMITS.maxPortfolio} photos.`);
      return;
    }
    setUrls((current) => [...current, value.slice(0, PROFILE_LIMITS.urlLength)]);
    setDraft("");
    setError(null);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= urls.length) return;
    setUrls((current) => {
      const next = current.slice();
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <div className="qf-vendor-v2-profile-portfolio">
      {/* The exact contract field. Newline-joined, because the server splits on
          newline or comma. */}
      <input type="hidden" name={name} value={urls.join("\n")} />

      <div className="qf-vendor-v2-profile-portfolio-head">
        <span className="qf-vendor-v2-profile-label">Portfolio photos</span>
        <span className="qf-vendor-v2-profile-count">
          {urls.length} / {PROFILE_LIMITS.maxPortfolio}
        </span>
      </div>

      {urls.length === 0 ? (
        <div className="qf-vendor-v2-profile-portfolio-empty">
          <VendorIcon name="inbox" size={20} />
          <p>Add project photos to help clients understand your work.</p>
        </div>
      ) : (
        <ul className="qf-vendor-v2-profile-portfolio-grid">
          {urls.map((url, index) => (
            <li key={url} className="qf-vendor-v2-profile-portfolio-item">
              <MediaPreview src={url} shape="cover" label={`Project photo ${index + 1}`} />
              <div className="qf-vendor-v2-profile-portfolio-actions">
                <button
                  type="button"
                  className="qf-vendor-v2-iconbtn"
                  aria-label={`Move project photo ${index + 1} earlier`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <VendorIcon name="arrow-right" size={15} className="qf-vendor-v2-profile-rot-left" />
                </button>
                <button
                  type="button"
                  className="qf-vendor-v2-iconbtn"
                  aria-label={`Move project photo ${index + 1} later`}
                  disabled={index === urls.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <VendorIcon name="arrow-right" size={15} />
                </button>
                <button
                  type="button"
                  className="qf-vendor-v2-iconbtn qf-vendor-v2-profile-remove"
                  aria-label={`Remove project photo ${index + 1}`}
                  onClick={() => setUrls((current) => current.filter((item) => item !== url))}
                >
                  <VendorIcon name="close" size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="qf-vendor-v2-profile-portfolio-add">
        <label className="qf-vendor-v2-profile-field">
          <span className="qf-vendor-v2-sr-only">Add a project photo link</span>
          <input
            type="url"
            inputMode="url"
            value={draft}
            disabled={full}
            maxLength={PROFILE_LIMITS.urlLength}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            placeholder={full ? "Portfolio is full" : "https://example.com/project.jpg"}
            className="qf-vendor-v2-profile-input"
            aria-describedby="qf-portfolio-help"
          />
        </label>
        <button
          type="button"
          className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
          onClick={add}
          disabled={full || draft.trim().length === 0}
        >
          Add photo
        </button>
      </div>

      <p className="qf-vendor-v2-profile-hint" id="qf-portfolio-help" role={error ? "alert" : undefined}>
        {error ?? "Paste an image link. Photos appear to clients in this order."}
      </p>
    </div>
  );
}
