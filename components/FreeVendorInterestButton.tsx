"use client";

import { useState } from "react";
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
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");

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
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>

      {open ? (
        <div className="qf-free-interest-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) close();
        }}>
          <section className="qf-free-interest-modal" role="dialog" aria-modal="true" aria-labelledby="qf-free-interest-title">
            <header className="qf-free-interest-head">
              <div>
                <span>Contact through QuickFurno</span>
                <h2 id="qf-free-interest-title">{vendorName}</h2>
              </div>
              <button type="button" aria-label="Close" onClick={close}>
                x
              </button>
            </header>

            {state === "success" ? (
              <div className="qf-free-interest-success">
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
                {message ? <p className="qf-free-interest-error">{message}</p> : null}
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
