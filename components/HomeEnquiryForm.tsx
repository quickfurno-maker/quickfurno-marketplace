"use client";

import { useEffect, useState } from "react";
import { submitLead } from "@/app/actions";
import { ENQUIRY_SERVICES, BUDGETS, TIMELINES, trackEvent } from "@/lib/config";
import { useActiveCities, NO_ACTIVE_CITIES_MESSAGE } from "@/lib/locations/useActiveCities";

export function HomeEnquiryForm({ defaultService }: { defaultService?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Phase 14B: cities come only from admin-managed active cities.
  const { cities: activeCities, loading: citiesLoading } = useActiveCities();

  const [f, setF] = useState({
    name: "", phone: "", city: "", area: "",
    service_required: defaultService && (ENQUIRY_SERVICES as readonly string[]).includes(defaultService) ? defaultService : ENQUIRY_SERVICES[0],
    budget: "", timeline: "", message: "",
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  // Default to the first active city once the list loads; keep the user's pick
  // if it is still active.
  useEffect(() => {
    if (!activeCities.length) return;
    setF((s) => (activeCities.includes(s.city) ? s : { ...s, city: activeCities[0] }));
  }, [activeCities]);

  async function onSubmit() {
    if (busy) return;

    setError(null);
    if (!f.name.trim() || !f.phone.trim() || !f.city || !f.service_required) {
      setError("Please add your name, phone, city and the service you need.");
      return;
    }
    if (f.phone.replace(/\D/g, "").length < 10) { setError("Please enter a valid phone number."); return; }
    setBusy(true);
    try {
      console.info("[home enquiry form] submitting", {
        source: "Homepage",
        city: f.city,
        service_category: f.service_required,
        has_budget_range: Boolean(f.budget),
        has_requirement: Boolean(f.message),
      });
      const res = await submitLead({ ...f, source: "Homepage" });
      if (!res.ok) { setError(res.error); return; }
      console.info("[home enquiry form] submission confirmed", {
        lead_id: res.data.id,
        is_duplicate: res.data.is_duplicate,
      });
      trackEvent("lead_submit", { source: "homepage", service: f.service_required });
      setDone(true);
    } catch (err) {
      console.error("[home enquiry form] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your enquiry. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-gold/50 bg-gold/15 text-gold">✓</div>
        <h3 className="mt-5 text-2xl text-ivory">Thank you!</h3>
        <p className="mx-auto mt-3 max-w-md font-sans text-sm text-muted">
          Your requirement has been received. Our team will verify and match you with suitable professionals.
        </p>
      </div>
    );
  }

  return (
    <div className="panel p-6 md:p-7">
      <h3 className="font-display text-xl text-ivory">Get free quotes</h3>
      <p className="mt-1 font-sans text-sm text-muted">One requirement → up to 3 verified pros. No charge, no spam.</p>

      {error && <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 font-sans text-sm text-red-200">{error}</p>}

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <L label="Full name"><input className="field" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Your name" /></L>
        <L label="Phone number"><input className="field" value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" placeholder="+91…" /></L>
        <L label="City"><select className="field" value={f.city} onChange={(e) => set("city", e.target.value)} disabled={activeCities.length === 0}>{activeCities.length === 0 ? <option value="" className="bg-navy-deep">{citiesLoading ? "Loading cities…" : NO_ACTIVE_CITIES_MESSAGE}</option> : activeCities.map((c) => <option key={c} className="bg-navy-deep">{c}</option>)}</select></L>
        <L label="Area / locality"><input className="field" value={f.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. Kharadi" /></L>
        <L label="Service required"><select className="field" value={f.service_required} onChange={(e) => set("service_required", e.target.value)}>{ENQUIRY_SERVICES.map((s) => <option key={s} className="bg-navy-deep">{s}</option>)}</select></L>
        <L label="Budget"><select className="field" value={f.budget} onChange={(e) => set("budget", e.target.value)}><option value="" className="bg-navy-deep">Select budget</option>{BUDGETS.map((b) => <option key={b} className="bg-navy-deep">{b}</option>)}</select></L>
        <L label="Timeline"><select className="field" value={f.timeline} onChange={(e) => set("timeline", e.target.value)}><option value="" className="bg-navy-deep">Select timeline</option>{TIMELINES.map((t) => <option key={t} className="bg-navy-deep">{t}</option>)}</select></L>
      </div>
      <L label="Project details (optional)"><textarea className="field min-h-[84px]" value={f.message} onChange={(e) => set("message", e.target.value)} placeholder="Tell us about your space…" /></L>

      <button onClick={onSubmit} disabled={busy} className="btn-gold mt-5 w-full">
        {busy ? "Sending…" : "Get Free Quotes"}
      </button>
      <p className="mt-3 font-sans text-xs text-muted/70">Your number is shared only with matched professionals. Never sold.</p>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}
