"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Approved vendor media with a graceful failure state (QF-UI-V2-07).
 *
 * A plain <img> is used deliberately: approved profile/cover/portfolio URLs may
 * point at arbitrary external hosts, and next/image would need a build-time host
 * allowlist (and would fetch server-side). The URL has already passed
 * safePublicImageUrl, so only local paths and http(s) reach here.
 *
 * If the image cannot load — a dead external link, a host blocking hotlinks —
 * the browser's broken-image icon is never shown; a neutral branded surface
 * takes its place.
 */
export function VendorProfileImage({
  src,
  alt,
  className,
  fallbackLabel,
  eager = false,
}: {
  src: string;
  alt: string;
  className?: string;
  /** Shown inside the neutral placeholder when the image cannot load. */
  fallbackLabel?: string;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  /*
    The markup is server-rendered, so a fast failure (an external 404) can happen
    BEFORE React hydrates and attaches onError — the event is then lost and the
    browser's broken-image marker stays on screen. Re-checking the element once
    on mount catches exactly that race: an <img> that has finished loading with a
    zero natural width did not decode.
  */
  useEffect(() => {
    const node = ref.current;
    if (node && node.complete && node.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) {
    return (
      <span className={`qf-vprofile-media-fallback ${className ?? ""}`} role="img" aria-label={alt}>
        {fallbackLabel ? <span aria-hidden="true">{fallbackLabel}</span> : null}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- approved vendor URLs from arbitrary hosts; a plain img avoids the next/image host allowlist and any server-side fetch.
    <img
      ref={ref}
      src={src}
      alt={alt}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
