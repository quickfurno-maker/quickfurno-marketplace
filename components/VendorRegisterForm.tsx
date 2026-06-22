"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";
import { submitVendorAccountRegistration } from "@/app/actions";
import { CITY, SERVICES } from "@/lib/config";

const CITIES = [CITY, "Mumbai", "Bengaluru", "Hyderabad", "Delhi", "Nagpur", "Nashik"];

export function VendorRegisterForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [f, setF] = useState({
    business_name: "", owner_name: "", phone: "", email: "", password: "",
    city: CITY, areas_covered: "", covers_full_city: false,
    service_categories: [] as string[], experience: "", gst_number: "",
    portfolio: "", message: "",
  });
  const set = (k: keyof typeof f, v: any) => setF((s) => ({ ...s, [k]: v }));
  const toggleService = (s: string) =>
    setF((p) => ({ ...p, service_categories: p.service_categories.includes(s) ? p.service_categories.filter((x) => x !== s) : [...p.service_categories, s] }));

  async function onSubmit() {
    if (busy) return;

    setError(null);
    if (!f.business_name.trim() || !f.phone.trim() || !f.email.trim() || f.password.length < 6) {
      setError("Add your business name, phone, email, and a password of at least 6 characters.");
      return;
    }
    if (f.phone.replace(/\D/g, "").length < 10) {
      setError("Please enter a valid 10 digit phone number.");
      return;
    }
    if (f.service_categories.length === 0) { setError("Pick at least one service you offer."); return; }
    setBusy(true);

    try {
      // Create the auth account and pending vendor row on the server.
      const res = await submitVendorAccountRegistration({
        business_name: f.business_name,
        owner_name: f.owner_name || undefined,
        phone: f.phone,
        email: f.email,
        city: f.city,
        areas_covered: f.areas_covered.split(",").map((a) => a.trim()).filter(Boolean),
        covers_full_city: f.covers_full_city,
        service_categories: f.service_categories,
        experience: f.experience || undefined,
        gst_number: f.gst_number || undefined,
        portfolio_urls: f.portfolio.split(",").map((u) => u.trim()).filter(Boolean),
        message: f.message || undefined,
        password: f.password,
      });
      if (!res.ok) { setError(res.error); return; }

      const { data: session, error: signInErr } = await browserClient().auth.signInWithPassword({
        email: f.email,
        password: f.password,
      });

      if (signInErr) { setDone(true); return; }
      if (session.session) { router.push("/vendor"); return; }
      setDone(true);
    } catch (err) {
      console.error("[vendor register form] submission error", {
        message: err instanceof Error ? err.message : "Unknown error",
      });
      setError("We could not submit your vendor registration. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="panel mx-auto max-w-xl p-8 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-gold/50 bg-gold/[0.15] text-gold">✓</div>
        <h2 className="mt-5 text-2xl text-ivory">Application received</h2>
        <p className="mx-auto mt-3 max-w-md font-sans text-sm text-muted">
          Confirm your email, then sign in to track approval. Our team reviews new studios before they go live.
        </p>
        <a href="/login" className="btn-gold mt-6">Go to sign in</a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {error && <p className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 font-sans text-sm text-red-200">{error}</p>}
      <div className="panel p-6 md:p-8">
        <div className="grid gap-5 sm:grid-cols-2">
          <L label="Business name"><input className="field" value={f.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Studio name" /></L>
          <L label="Owner name"><input className="field" value={f.owner_name} onChange={(e) => set("owner_name", e.target.value)} /></L>
          <L label="Phone (WhatsApp)"><input className="field" value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" placeholder="+91…" /></L>
          <L label="Work email"><input className="field" value={f.email} onChange={(e) => set("email", e.target.value)} inputMode="email" /></L>
          <L label="Password"><input className="field" type="password" value={f.password} onChange={(e) => set("password", e.target.value)} placeholder="At least 6 characters" /></L>
          <L label="City"><select className="field" value={f.city} onChange={(e) => set("city", e.target.value)}>{CITIES.map((c) => <option key={c} className="bg-navy-deep">{c}</option>)}</select></L>
          <L label="Areas covered (comma separated)"><input className="field" value={f.areas_covered} onChange={(e) => set("areas_covered", e.target.value)} placeholder="Kharadi, Wagholi, Viman Nagar" /></L>
          <L label="Experience"><input className="field" value={f.experience} onChange={(e) => set("experience", e.target.value)} placeholder="e.g. 8 years" /></L>
          <L label="GST number (optional)"><input className="field" value={f.gst_number} onChange={(e) => set("gst_number", e.target.value)} /></L>
          <L label="Portfolio / website / Instagram"><input className="field" value={f.portfolio} onChange={(e) => set("portfolio", e.target.value)} placeholder="https://… (comma-separate multiple)" /></L>
          <label className="flex items-center gap-3 self-end font-sans text-sm text-muted">
            <input type="checkbox" checked={f.covers_full_city} onChange={(e) => set("covers_full_city", e.target.checked)} className="h-4 w-4 accent-gold" />
            We cover the whole city
          </label>
        </div>

        <div className="mt-5">
          <L label="Message (optional)"><textarea className="field min-h-[80px]" value={f.message} onChange={(e) => set("message", e.target.value)} placeholder="Tell us about your studio and the work you do best…" /></L>
        </div>

        <div className="mt-6">
          <span className="label">Services you offer</span>
          <div className="flex flex-wrap gap-2">
            {SERVICES.map((s) => (
              <button key={s} type="button" onClick={() => toggleService(s)}
                className={`pill ${f.service_categories.includes(s) ? "chip-on" : ""}`}>{s}</button>
            ))}
          </div>
        </div>

        <button onClick={onSubmit} disabled={busy} className="btn-gold mt-7 w-full sm:w-auto">
          {busy ? "Submitting…" : "Apply to become a partner"}
        </button>
        <p className="mt-3 font-sans text-xs text-muted/70">
          New studios are reviewed before going live. You’ll buy a lead pack once approved.
        </p>
      </div>
    </div>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}
