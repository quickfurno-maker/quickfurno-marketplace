"use client";

// ============================================================================
// QuickFurno — components/vendors/ClientSelectedVendorEnquiry.tsx
// Phase 26A-2E: "Send enquiry to this vendor" on a vendor profile. The vendor's
// city / category / subcategory / parent group / service area are auto-prefilled
// and locked (hidden context); the client only fills name, phone, area (editable,
// suggested), budget, timeline, requirement, and consent. QuickFurno prioritises
// THIS vendor (assign immediately if eligible; otherwise a 1-hour recharge window
// before auto-filling other vendors). No credit logic here; no live WhatsApp.
// ============================================================================
import { useState } from "react";
import { sendClientSelectedVendorEnquiry } from "@/app/actions";

type Props = {
  vendorId: string;
  vendorName: string;
  city: string;
  area?: string;
  serviceCategory: string;
  subcategory?: string;
  parentCategoryGroup?: string;
  className?: string;
};

const PHONE_RE = /^[6-9]\d{9}$/;

const BUDGETS = ["Below ₹1 lakh", "₹1–3 lakh", "₹3–7 lakh", "₹7–15 lakh", "₹15 lakh+", "Not sure yet"];
const TIMELINES = ["Immediately", "Within 15 days", "Within 1 month", "Just exploring"];

function cleanPhone(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(-10);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 10);
}

export function ClientSelectedVendorEnquiry({
  vendorId,
  vendorName,
  city,
  area,
  serviceCategory,
  subcategory,
  parentCategoryGroup,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [projectArea, setProjectArea] = useState(area ?? "");
  const [budget, setBudget] = useState("");
  const [timeline, setTimeline] = useState("");
  const [requirement, setRequirement] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  async function submit() {
    setError("");
    if (name.trim().length < 2) return setError("Please enter your name.");
    if (!PHONE_RE.test(phone)) return setError("Enter a valid 10-digit mobile number.");
    if (!consent) return setError("Please accept the consent to continue.");

    setBusy(true);
    try {
      const res = await sendClientSelectedVendorEnquiry({
        name: name.trim(),
        phone,
        city,
        area: projectArea.trim() || area || undefined,
        service_category: serviceCategory,
        subcategory,
        budget_range: budget || undefined,
        timeline: timeline || undefined,
        requirement: requirement.trim() || undefined,
        source: "vendor_profile",
        share_consent: true,
        vendor_id: vendorId,
        vendor_name: vendorName,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDoneMessage(res.data.message);
    } catch {
      setError("We could not send your enquiry. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (doneMessage) {
    return (
      <div className="qf-cs-enquiry qf-cs-enquiry--done" role="status">
        <span className="qf-cs-enquiry-check" aria-hidden="true">✓</span>
        <p>{doneMessage}</p>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="qf-cs-enquiry">
        <button type="button" className={className} onClick={() => setOpen(true)}>
          Send enquiry to this vendor
        </button>
        <p className="qf-cs-enquiry-hint">
          You can connect with up to 3 verified vendors for this requirement. After you send this enquiry, you will have
          1 hour to choose more vendors. If you do not, QuickFurno will connect you with suitable verified vendors
          automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="qf-cs-enquiry qf-cs-enquiry--form">
      {error ? (
        <p className="qf-cs-enquiry-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* Auto-prefilled from the vendor profile — shown read-only, not editable. */}
      <div className="qf-cs-enquiry-locked">
        <span>{[serviceCategory, subcategory].filter(Boolean).join(" · ")}</span>
        <span>{[city, parentCategoryGroup].filter(Boolean).join(" · ")}</span>
      </div>

      <label className="qf-cs-enquiry-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your full name" autoComplete="name" />
      </label>
      <label className="qf-cs-enquiry-field">
        <span>Phone number</span>
        <input
          value={phone}
          onChange={(e) => setPhone(cleanPhone(e.target.value))}
          placeholder="10-digit mobile number"
          inputMode="numeric"
          maxLength={10}
          autoComplete="tel"
        />
      </label>
      <label className="qf-cs-enquiry-field">
        <span>Project area / locality</span>
        <input
          value={projectArea}
          onChange={(e) => setProjectArea(e.target.value)}
          placeholder={area ? area : "e.g. Kharadi, Baner"}
        />
      </label>
      <label className="qf-cs-enquiry-field">
        <span>Budget</span>
        <select value={budget} onChange={(e) => setBudget(e.target.value)}>
          <option value="">Select budget</option>
          {BUDGETS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <label className="qf-cs-enquiry-field">
        <span>Timeline</span>
        <select value={timeline} onChange={(e) => setTimeline(e.target.value)}>
          <option value="">Select timeline</option>
          {TIMELINES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="qf-cs-enquiry-field">
        <span>Requirement details (optional)</span>
        <textarea
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
          rows={3}
          placeholder="Tell the vendor about your project…"
        />
      </label>
      <label className="qf-cs-enquiry-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I agree that QuickFurno may share my enquiry and contact details with up to 3 verified vendors for this
          requirement within 3 days. If I select a specific vendor, that vendor will be prioritised first, and QuickFurno
          may fill remaining slots with suitable verified vendors.
        </span>
      </label>
      <button type="button" className={className} disabled={busy} onClick={submit}>
        {busy ? "Sending…" : `Send to ${vendorName}`}
      </button>
      <p className="qf-cs-enquiry-multi">
        You can create separate requests for other services like sofa, painting, or civil work, each with up to 3
        verified vendors.
      </p>
    </div>
  );
}
