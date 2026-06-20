import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Brand";
import { HomeEnquiryForm } from "@/components/HomeEnquiryForm";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { CITY, SERVICE_CARDS, PACKAGES_PREVIEW } from "@/lib/config";

const TRUST = ["Verified local professionals", "Up to 4 quotes", "No spam", `${CITY} first`, "Free enquiry"];

const STEPS = [
  { n: "01", t: "Submit your requirement", d: "Tell us the job, your area and budget — takes under two minutes." },
  { n: "02", t: "QuickFurno verifies details", d: "We confirm your enquiry so only genuine projects reach our partners." },
  { n: "03", t: "Get matched with up to 4 pros", d: "A short, hand-checked shortlist of local studios — never a crowd." },
  { n: "04", t: "Compare quotes and start work", d: "Talk to each, compare quotes, and pick the one that fits." },
];

const FAQS = [
  { q: "Is the enquiry free for homeowners?", a: "Yes. Submitting a requirement and receiving quotes is completely free for homeowners." },
  { q: "How many vendors will contact me?", a: "At most four verified professionals — chosen for your area and service. We never resell your enquiry to a crowd." },
  { q: "Are the vendors verified?", a: "Every studio is reviewed before listing — work photos, service area, response quality and basic business details." },
  { q: "Which services are covered?", a: "Full home interiors, modular kitchens, wardrobes, carpentry, false ceiling, painting, renovation and custom furniture." },
  { q: "How do vendors receive leads?", a: "Approved studios buy prepaid lead credits and receive filtered, area-matched enquiries in their dashboard." },
  { q: "What if a vendor gets a bad lead?", a: "Vendors can report a bad lead within 24 hours. On approval, the lead credit is refunded automatically." },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* 1 + 2 — HERO with embedded enquiry form */}
      <section className="mx-auto max-w-6xl px-5 pt-14 pb-16 md:pt-20">
        <div className="grid items-start gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow">{CITY} · verified local professionals</p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.05] text-ivory md:text-5xl">
              Find Verified <span className="text-gold">Interior Designers</span> &amp; Carpenters in {CITY}
            </h1>
            <p className="mt-5 max-w-xl font-sans text-lg leading-relaxed text-muted">
              Share your requirement once and get matched with up to 4 trusted local professionals for
              interiors, kitchens, wardrobes, carpentry, renovation and more.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href="#get-quotes" className="btn-gold">Get Free Quotes</a>
              <Link href="/vendors/register" className="btn-ghost">Register as Partner</Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-2">
              {TRUST.map((t) => (
                <li key={t} className="pill"><span className="mr-1.5 text-gold">✓</span>{t}</li>
              ))}
            </ul>
            <div className="mt-8"><WhatsAppButton source="hero" /></div>
          </div>

          <div id="get-quotes" className="scroll-mt-24">
            <HomeEnquiryForm />
          </div>
        </div>
      </section>

      {/* 3 — WHATSAPP band */}
      <section className="mx-auto max-w-6xl px-5">
        <div className="panel flex flex-col items-center justify-between gap-4 p-6 md:flex-row">
          <div>
            <h3 className="font-display text-xl text-ivory">Prefer to chat?</h3>
            <p className="mt-1 font-sans text-sm text-muted">Message us on WhatsApp and we’ll help you get started.</p>
          </div>
          <WhatsAppButton className="btn-gold" source="band" />
        </div>
      </section>

      {/* 4 — HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-16">
        <p className="eyebrow">How it works</p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="panel panel-hover p-6">
              <span className="font-display text-2xl text-gold/80">{s.n}</span>
              <h3 className="mt-3 text-lg text-ivory">{s.t}</h3>
              <p className="mt-2 font-sans text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 5 — SERVICE CATEGORIES */}
      <section className="mx-auto max-w-6xl px-5 py-8">
        <p className="eyebrow">What we cover</p>
        <h2 className="mt-3 text-2xl font-semibold text-ivory md:text-3xl">Services for every part of your home</h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICE_CARDS.map((c) => (
            <Link key={c.name} href={`/enquiry?service=${encodeURIComponent(c.name)}`} className="panel panel-hover group p-5">
              <h3 className="font-display text-lg text-ivory">{c.name}</h3>
              <p className="mt-2 font-sans text-sm leading-relaxed text-muted">{c.blurb}</p>
              <span className="mt-4 inline-flex items-center gap-1 font-sans text-xs font-semibold text-gold opacity-0 transition group-hover:opacity-100">
                Get quotes →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 6 — TRUST & VERIFICATION */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="panel grid gap-8 p-8 md:grid-cols-2 md:p-10">
          <div>
            <p className="eyebrow">Why QuickFurno</p>
            <h2 className="mt-3 text-2xl font-semibold text-ivory md:text-3xl">Verified pros. Filtered leads. No spam.</h2>
            <p className="mt-4 font-sans text-muted">
              We verify every studio before listing — so homeowners deal with genuine local professionals,
              and partners receive real, filtered enquiries.
            </p>
          </div>
          <ul className="grid gap-3">
            {[
              "We verify vendors before listing them",
              "We check work photos, service area, response quality and basic business details",
              "Customers are never spammed by unlimited vendors — four pros at most",
              "Vendors receive filtered, area-matched leads only",
            ].map((t) => (
              <li key={t} className="flex gap-3 rounded-lg border border-white/[0.08] bg-white/[0.03] p-4 font-sans text-sm text-muted">
                <span className="mt-0.5 text-gold">✓</span>{t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 7 — VENDOR / PARTNER */}
      <section className="mx-auto max-w-6xl px-5 py-8">
        <div className="panel p-8 md:p-10">
          <div className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
            <div>
              <p className="eyebrow">For partners</p>
              <h2 className="mt-3 text-2xl font-semibold text-ivory md:text-3xl">
                Grow your interior and carpentry business with verified local leads
              </h2>
              <p className="mt-4 max-w-xl font-sans text-muted">
                Join QuickFurno as a verified partner and receive customer enquiries from your service area.
                Buy lead credits, respond faster, and grow your project pipeline.
              </p>
              <Link href="/vendors/register" className="btn-gold mt-6">Register as Partner</Link>
            </div>
            <ul className="grid gap-3 self-center">
              {["Verified customer enquiries", "Lead credits system", `${CITY} local demand`, "Bad lead review process", "Dashboard access"].map((t) => (
                <li key={t} className="flex gap-3 font-sans text-sm text-muted"><span className="text-gold">◆</span>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 8 — LEAD PACKAGE PREVIEW */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <p className="eyebrow">Lead packs for partners</p>
        <h2 className="mt-3 text-2xl font-semibold text-ivory md:text-3xl">Simple prepaid credits</h2>
        <div className="mt-7 grid gap-5 sm:grid-cols-3">
          {PACKAGES_PREVIEW.map((p) => (
            <div key={p.name} className={`panel p-6 ${p.tag ? "!border-gold/60 shadow-gold" : ""}`}>
              {p.tag && <span className="eyebrow">{p.tag}</span>}
              <h3 className="mt-2 font-display text-xl text-ivory">{p.name}</h3>
              <p className="mt-4"><span className="stat-num">₹{p.price.toLocaleString("en-IN")}</span></p>
              <p className="mt-1 font-sans text-sm text-muted">{p.leads} leads</p>
              <Link href="/vendors/register" className={`${p.tag ? "btn-gold" : "btn-ghost"} mt-6 w-full`}>Apply to join</Link>
            </div>
          ))}
        </div>
        <p className="mt-5 font-sans text-xs text-muted/70">Pricing can be updated anytime from admin/config.</p>
      </section>

      {/* 9 — FAQ */}
      <section className="mx-auto max-w-3xl px-5 py-8">
        <p className="eyebrow">Questions</p>
        <h2 className="mt-3 text-2xl font-semibold text-ivory md:text-3xl">Frequently asked</h2>
        <div className="mt-7 space-y-3">
          {FAQS.map((f) => (
            <details key={f.q} className="panel group p-5">
              <summary className="flex cursor-pointer list-none items-center justify-between font-sans text-base font-medium text-ivory">
                {f.q}
                <span className="text-gold transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 font-sans text-sm leading-relaxed text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
