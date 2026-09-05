"use client";

import { useEffect, useState } from "react";
import { submitLead } from "@/app/actions";
import { BUDGETS } from "@/lib/config";
import { useActiveCities, NO_ACTIVE_CITIES_MESSAGE } from "@/lib/locations/useActiveCities";
import { useActiveCategories, NO_ACTIVE_CATEGORIES_MESSAGE } from "@/lib/categories/useActiveCategories";

/**
 * Standalone enquiry funnel for /enquiry.
 *
 * QF-UI-V2-09 restyled this onto the V2 public system. The SUBMISSION AUTHORITY
 * IS UNCHANGED: the same submitLead() call, the same field names, the same
 * `source: "Enquiry funnel"`, the same share_consent flag, the same UTM capture,
 * the same admin-managed active cities/categories, the same ?service= default
 * and the same validation rules. Only presentation and a few copy lines moved.
 */

type Step = "form" | "done";

export function LeadFunnel({ defaultService }: { defaultService?: string }) {
  const [step, setStep] = useState<Step>("form");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Phase 14B/14C: cities + services come only from admin-managed active
  // cities and active categories.
  const { cities: activeCities, loading: citiesLoading } = useActiveCities();
  const { categories: activeCategories, loading: categoriesLoading } = useActiveCategories();

  const [form, setForm] = useState({
    name: "", phone: "", city: "",
    service_required: "",
    area: "", budget: "", property_type: "", timeline: "", message: "",
  });
  const [consent, setConsent] = useState(false);

  // Default to the first active city once loaded; keep the user's pick if active.
  useEffect(() => {
    if (!activeCities.length) return;
    setForm((f) => (activeCities.includes(f.city) ? f : { ...f, city: activeCities[0] }));
  }, [activeCities]);

  // Default to defaultService (if active) or the first active category.
  useEffect(() => {
    if (!activeCategories.length) return;
    setForm((f) => {
      if (activeCategories.includes(f.service_required)) return f;
      const preferred = defaultService && activeCategories.includes(defaultService) ? defaultService : activeCategories[0];
      return { ...f, service_required: preferred };
    });
  }, [activeCategories, defaultService]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function readTracking() {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    const pick = (key: string) => params.get(key)?.trim() || undefined;
    return {
      source_url: window.location.href,
      utm_source: pick("utm_source"),
      utm_medium: pick("utm_medium"),
      utm_campaign: pick("utm_campaign"),
      utm_term: pick("utm_term"),
      utm_content: pick("utm_content"),
    };
  }

  async function onSubmitForm() {
    if (busy) return;

    setError(null);
    if (!form.name.trim() || !form.phone.trim() || !form.city || !form.service_required) {
      setError("Please add your name, phone, city and the service you need.");
      return;
    }
    if (form.phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid phone number.");
      return;
    }
    if (!consent) {
      setError("Please accept sharing your details with up to 3 verified vendors to continue.");
      return;
    }
    setBusy(true);
    try {
      console.info("[lead funnel] submitting", {
        source: "Enquiry funnel",
        city: form.city,
        service_category: form.service_required,
        has_budget_range: Boolean(form.budget),
        has_requirement: Boolean(form.message),
      });
      const res = await submitLead({
        ...form,
        source: "Enquiry funnel",
        share_consent: consent,
        ...readTracking(),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      console.info("[lead funnel] submission confirmed", {
        lead_id: res.data.id,
        is_duplicate: res.data.is_duplicate,
      });
      setStep("done");
    } catch (err) {
      console.error("[lead funnel] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your enquiry. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="qf-enqpage-success" role="status">
        <span className="qf-enqpage-success-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" focusable="false">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2>Your enquiry is submitted</h2>
        <p>
          QuickFurno will share your requirement with up to 3 relevant verified vendors that match
          your service and area.
        </p>
        <a href="/" className="qf-pub-btn qf-pub-btn--secondary">
          Back to home
        </a>
      </div>
    );
  }

  return (
    <div className="qf-enqpage-panel">
      <Steps step={step} />

      {error ? (
        <p className="qf-enqpage-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="qf-enqpage-grid">
        <Field label="Your name">
          <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Asha Kulkarni" autoComplete="name" />
        </Field>
        <Field label="Phone (WhatsApp)">
          <input value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="10-digit mobile number" inputMode="tel" autoComplete="tel" />
        </Field>
        <Field label="City">
          <select value={form.city} onChange={(e) => set("city", e.target.value)} disabled={activeCities.length === 0}>
            {activeCities.length === 0
              ? <option value="">{citiesLoading ? "Loading cities…" : NO_ACTIVE_CITIES_MESSAGE}</option>
              : activeCities.map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Area / locality">
          <input value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Kharadi" />
        </Field>
        <Field label="Service needed">
          <select value={form.service_required} onChange={(e) => set("service_required", e.target.value)} disabled={activeCategories.length === 0}>
            {activeCategories.length === 0
              ? <option value="">{categoriesLoading ? "Loading services…" : NO_ACTIVE_CATEGORIES_MESSAGE}</option>
              : activeCategories.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Budget (optional)">
          <select value={form.budget} onChange={(e) => set("budget", e.target.value)}>
            <option value="">Not sure yet</option>
            {BUDGETS.map((b) => <option key={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="Property type (optional)">
          <input value={form.property_type} onChange={(e) => set("property_type", e.target.value)} placeholder="2BHK, villa…" />
        </Field>
        <Field label="Timeline (optional)">
          <input value={form.timeline} onChange={(e) => set("timeline", e.target.value)} placeholder="Within 2 months" />
        </Field>
        <Field label="Anything else (optional)" wide>
          <textarea value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="Tell the vendors about your space…" />
        </Field>
      </div>

      <label className="qf-enqpage-consent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          I agree that QuickFurno may share my enquiry and contact details with up to 3 verified vendors initially. If vendors are unavailable, non-responsive, or unable to serve my requirement, QuickFurno may manually connect me with additional verified vendors to fulfil my request. See our{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{" "}
          and{" "}
          <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>.
        </span>
      </label>

      <button
        onClick={onSubmitForm}
        disabled={busy}
        className="qf-pub-btn qf-pub-btn--primary qf-enqpage-submit"
      >
        {busy ? "Submitting…" : "Get matched with vendors"}
      </button>
      <p className="qf-enqpage-fineprint">
        Your number is shared only with the vendors you are matched to. We never sell your details.
      </p>
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items: [Step, string][] = [["form", "Your project"], ["done", "Submitted"]];
  const idx = items.findIndex(([s]) => s === step);
  return (
    <div className="qf-enqpage-steps">
      {items.map(([s, label], i) => (
        <div key={s} className="qf-enqpage-steps" style={{ margin: 0 }}>
          <span
            className="qf-enqpage-step"
            data-state={i < idx ? "done" : i === idx ? "current" : "upcoming"}
          >
            <span className="qf-enqpage-step-dot">{i < idx ? "✓" : i + 1}</span>
            {label}
          </span>
          {i < items.length - 1 ? <span className="qf-enqpage-step-rule" aria-hidden="true" /> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={`qf-enqpage-field${wide ? " qf-enqpage-field--wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
