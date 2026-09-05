"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { submitFreeVendorProfileInterest } from "@/app/actions";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function FreeVendorInterestButton({
  vendorId,
  vendorName,
  city,
  area,
  category,
  subcategory,
  className,
  children = "Request Callback",
}: {
  vendorId: string;
  vendorName: string;
  city?: string | null;
  area?: string | null;
  category?: string | null;
  subcategory?: string | null;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

  /*
    QF-UI-V2-08 — page scroll lock, Escape and focus handling.

    This modal previously had none of the three: the page scrolled freely behind
    it (measured 300 -> 1260 with a dispatched wheel), Escape did nothing, and
    focus stayed on <body>. The lock targets documentElement because `html` is
    the scrolling element on public pages (QF-UI-V2-05 made body a non-scroll
    container on purpose). Previous INLINE values are restored on close, with
    scrollbar-width compensation only while the dialog is mounted, so nothing
    shifts open or closed.
  */
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPaddingRight = root.style.paddingRight;
    const scrollbarWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbarWidth > 0) root.style.paddingRight = `${scrollbarWidth}px`;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => dialogRef.current?.focus(), 60);
    // Captured now so the cleanup does not read a ref that may have moved on.
    const trigger = triggerRef.current;

    return () => {
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPaddingRight;
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
      // Return focus to the control that opened the dialog.
      trigger?.focus();
    };
  }, [open]);

  const cleanPhone = phone.replace(/\D/g, "").slice(0, 10);
  const canSubmit = name.trim().length >= 2 && /^[6-9]\d{9}$/.test(cleanPhone) && state !== "submitting";

  async function submit() {
    if (!canSubmit) {
      setState("error");
      setMessage("Please enter your name and a valid 10-digit mobile number.");
      return;
    }

    setState("submitting");
    setMessage("");
    const result = await submitFreeVendorProfileInterest({
      vendorId,
      clientName: name.trim(),
      clientPhone: cleanPhone,
      city,
      area,
      category,
      subcategory,
      interestType: "profile_contact_request",
    });

    if (!result.ok) {
      setState("error");
      setMessage(result.error);
      return;
    }

    setState("success");
    setMessage(result.data.message);
  }

  function close() {
    setOpen(false);
    setState("idle");
    setMessage("");
    setName("");
    setPhone("");
  }

  return (
    <>
      <button ref={triggerRef} type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {open ? (
        <div className="qf-free-interest-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section
            ref={dialogRef}
            tabIndex={-1}
            className="qf-free-interest-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="qf-free-interest-title"
          >
            <header className="qf-free-interest-head">
              <div>
                <span>Contact through QuickFurno</span>
                <h2 id="qf-free-interest-title">{vendorName}</h2>
              </div>
              <button type="button" className="qf-free-interest-close" aria-label="Close callback request" onClick={close}>
                <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                  <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            {state === "success" ? (
              <div className="qf-free-interest-success" role="status">
                <strong>Request received</strong>
                <p>{message}</p>
                <button type="button" onClick={close}>
                  Done
                </button>
              </div>
            ) : (
              <div className="qf-free-interest-body">
                <p>QuickFurno will register your interest and help you connect safely.</p>
                <label>
                  <span>Name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" autoComplete="name" />
                </label>
                <label>
                  <span>Mobile number</span>
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="10-digit mobile number"
                    inputMode="numeric"
                    autoComplete="tel"
                    maxLength={10}
                  />
                </label>
                {message ? <p className="qf-free-interest-error" role="alert">{message}</p> : null}
                <div className="qf-free-interest-actions">
                  <button type="button" onClick={close}>Cancel</button>
                  <button type="button" disabled={state === "submitting"} onClick={submit}>
                    {state === "submitting" ? "Submitting..." : "Request Callback"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
