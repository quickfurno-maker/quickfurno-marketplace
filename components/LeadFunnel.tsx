"use client";

import { useEffect, useState } from "react";
import { submitLead, fetchEligibleVendors, assignLead } from "@/app/actions";
import type { PublicVendorCard } from "@/lib/types";
import { BUDGETS, MAX_VENDORS_PER_LEAD } from "@/lib/config";
import { useActiveCities, NO_ACTIVE_CITIES_MESSAGE } from "@/lib/locations/useActiveCities";
import { useActiveCategories, NO_ACTIVE_CATEGORIES_MESSAGE } from "@/lib/categories/useActiveCategories";

type Step = "form" | "pick" | "done";

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

  const [leadId, setLeadId] = useState<string | null>(null);
  const [vendors, setVendors] = useState<PublicVendorCard[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [assignedCount, setAssignedCount] = useState(0);
  const [consent, setConsent] = useState(false);

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
    if (form.phone.replace(/\D/g, "").length < 10) { setError("Please enter a valid phone number."); return; }
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
      if (!res.ok) { setError(res.error); return; }
      console.info("[lead funnel] submission confirmed", {
        lead_id: res.data.id,
        is_duplicate: res.data.is_duplicate,
      });
      setLeadId(res.data.id);
      setAssignedCount(0);
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

  function togglePick(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_VENDORS_PER_LEAD ? p : [...p, id]));
  }

  async function onConfirm() {
    if (busy || !leadId) return;

    setBusy(true);
    setError(null);
    try {
      const res = await assignLead(leadId, picked);
      if (!res.ok) { setError(res.error); return; }
      setAssignedCount(res.data.assigned_count);
      setStep("done");
    } catch (err) {
      console.error("[lead funnel] assignment error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not finish matching your enquiry. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Steps step={step} />

      {error && (
        <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 font-sans text-sm text-red-200">
          {error}
        </p>
      )}

      {step === "form" && (
        <div className="mt-6 panel p-6 md:p-8">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Your name">
              <input className="field" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Asha Kulkarni" />
            </Field>
            <Field label="Phone (WhatsApp)">
              <input className="field" value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91…" inputMode="tel" />
            </Field>
            <Field label="City">
              <select className="field" value={form.city} onChange={(e) => set("city", e.target.value)} disabled={activeCities.length === 0}>
                {activeCities.length === 0
                  ? <option value="" className="bg-navy-deep">{citiesLoading ? "Loading cities…" : NO_ACTIVE_CITIES_MESSAGE}</option>
                  : activeCities.map((c) => <option key={c} className="bg-navy-deep">{c}</option>)}
              </select>
            </Field>
            <Field label="Area / locality">
              <input className="field" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Kharadi" />
            </Field>
            <Field label="Service needed">
              <select className="field" value={form.service_required} onChange={(e) => set("service_required", e.target.value)} disabled={activeCategories.length === 0}>
                {activeCategories.length === 0
                  ? <option value="" className="bg-navy-deep">{categoriesLoading ? "Loading services…" : NO_ACTIVE_CATEGORIES_MESSAGE}</option>
                  : activeCategories.map((s) => <option key={s} className="bg-navy-deep">{s}</option>)}
              </select>
            </Field>
            <Field label="Budget (optional)">
              <select className="field" value={form.budget} onChange={(e) => set("budget", e.target.value)}>
                <option value="" className="bg-navy-deep">Not sure yet</option>
                {BUDGETS.map((b) => <option key={b} className="bg-navy-deep">{b}</option>)}
              </select>
            </Field>
            <Field label="Property type (optional)">
              <input className="field" value={form.property_type} onChange={(e) => set("property_type", e.target.value)} placeholder="2BHK, villa…" />
            </Field>
            <Field label="Timeline (optional)">
              <input className="field" value={form.timeline} onChange={(e) => set("timeline", e.target.value)} placeholder="Within 2 months" />
            </Field>
          </div>
          <Field label="Anything else (optional)">
            <textarea className="field min-h-[90px]" value={form.message} onChange={(e) => set("message", e.target.value)} placeholder="Tell the studios about your space…" />
          </Field>
          <label className="mt-5 flex items-start gap-3 font-sans text-xs leading-5 text-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-gold"
            />
            <span>
              I agree that QuickFurno may share my enquiry and contact details with up to 3 verified vendors for my selected service. See our{" "}
              <a href="/privacy" className="text-gold underline" target="_blank" rel="noopener noreferrer">Privacy Policy</a>{" "}
              and{" "}
              <a href="/terms" className="text-gold underline" target="_blank" rel="noopener noreferrer">Terms</a>.
            </span>
          </label>
          <button onClick={onSubmitForm} disabled={busy} className="btn-gold mt-6 w-full sm:w-auto">
            {busy ? "Finding studios…" : "Find matching studios"}
          </button>
          <p className="mt-3 font-sans text-xs text-muted/70">Your number is shared only with the studios you’re matched to. Never sold.</p>
        </div>
      )}

      {step === "pick" && (
        <div className="mt-6">
          <p className="font-sans text-sm text-muted">
            {vendors.length > 0
              ? <>Pick up to <span className="text-gold">{MAX_VENDORS_PER_LEAD}</span> studios. We’ll complete the shortlist if you choose fewer.</>
              : "No studios are open in your area right now — submit anyway and our team will match you manually."}
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {vendors.map((v) => {
              const on = picked.includes(v.id);
              const full = !on && picked.length >= MAX_VENDORS_PER_LEAD;
              return (
                <button
                  key={v.id}
                  onClick={() => togglePick(v.id)}
                  disabled={full}
                  className={`panel panel-hover p-5 text-left transition ${on ? "!border-gold/70 !bg-gold/10" : ""} ${full ? "opacity-40" : ""}`}
                  aria-pressed={on}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-lg text-ivory">{v.business_name}</h3>
                      <p className="mt-0.5 text-xs uppercase tracking-wider text-muted">{v.city}{v.areas_covered?.length ? ` · ${v.areas_covered.slice(0, 3).join(", ")}` : ""}</p>
                    </div>
                    <span className={`mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] ${on ? "border-gold bg-gold text-navy-ink" : "border-white/25"}`}>{on ? "✓" : ""}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(v.service_categories ?? []).slice(0, 3).map((s) => <span key={s} className="pill !text-[0.65rem]">{s}</span>)}
                  </div>
                  <p className="mt-3 font-sans text-xs text-muted">
                    {v.rating > 0 ? `★ ${v.rating.toFixed(1)}` : "New"} · {v.completed_projects} projects{v.experience ? ` · ${v.experience}` : ""}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button onClick={onConfirm} disabled={busy} className="btn-gold">
              {busy ? "Sending…" : picked.length ? `Confirm ${picked.length} & auto-fill to ${MAX_VENDORS_PER_LEAD}` : "Match me automatically"}
            </button>
            <span className="font-sans text-xs text-muted">{picked.length}/{MAX_VENDORS_PER_LEAD} selected</span>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="mt-6 panel p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-gold/50 bg-gold/[0.15] text-gold">✓</div>
          <h2 className="mt-5 text-2xl text-ivory">Your enquiry is submitted</h2>
          <p className="mx-auto mt-3 max-w-md font-sans text-sm text-muted">
            QuickFurno will share your requirement with up to 3 eligible verified vendors. WhatsApp remains preview-only in this phase.
          </p>
          <a href="/" className="btn-ghost mt-6">Back to home</a>
        </div>
      )}
    </div>
  );
}

function Steps({ step }: { step: Step }) {
  const items: [Step, string][] = [["form", "Your project"], ["pick", "Choose studios"], ["done", "Matched"]];
  const idx = items.findIndex(([s]) => s === step);
  return (
    <div className="flex items-center gap-3">
      {items.map(([s, label], i) => (
        <div key={s} className="flex items-center gap-3">
          <span className={`flex items-center gap-2 font-sans text-xs uppercase tracking-wider ${i <= idx ? "text-gold" : "text-muted/50"}`}>
            <span className={`grid h-6 w-6 place-items-center rounded-full border text-[11px] ${i <= idx ? "border-gold bg-gold/[0.15] text-gold" : "border-white/[0.15] text-muted/50"}`}>{i + 1}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
          {i < items.length - 1 && <span className={`h-px w-6 ${i < idx ? "bg-gold/50" : "bg-white/10"}`} />}
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
