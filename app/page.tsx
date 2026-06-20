import Link from "next/link";
import { SiteHeader, SiteFooter, Wordmark } from "@/components/Brand";

const STEPS = [
  { n: "01", t: "Tell us the job", d: "Share your city, area, and what you need — kitchen, wardrobe, full interiors." },
  { n: "02", t: "Pick your studios", d: "See verified local studios that match. Choose the ones you like, or let us complete the shortlist." },
  { n: "03", t: "Get up to 4 quotes", d: "A handful of trusted pros — never a crowd — reach out with real quotes. No spam, no resold leads." },
];

const SERVICES = ["Interior Design", "Modular Kitchen", "Wardrobe", "Carpentry", "False Ceiling", "Painting", "Renovation"];

export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* HERO */}
      <section className="relative mx-auto max-w-6xl px-5 pt-16 pb-20 md:pt-24">
        <p className="eyebrow">Pune · verified local studios</p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.05] text-ivory md:text-6xl">
          One enquiry.{" "}
          <span className="text-gold">Up&nbsp;to&nbsp;four</span> studios who actually want the work.
        </h1>
        <p className="mt-6 max-w-xl font-sans text-lg leading-relaxed text-muted">
          QuickFurno matches your home project to a short, hand-checked list of interior and
          carpentry studios — capped at four, so you get real attention instead of a call centre.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <Link href="/enquiry" className="btn-gold">Get free quotes</Link>
          <Link href="/vendors/register" className="btn-ghost">Become a partner studio</Link>
        </div>

        {/* signature: the 1 → 4 matching mechanic, made literal */}
        <div className="mt-14 panel p-6 md:p-8">
          <div className="grid items-center gap-6 md:grid-cols-[auto_1fr]">
            <div className="flex items-center gap-4">
              <div className="grid h-16 w-16 place-items-center rounded-full border border-gold/40 bg-gold/10 text-center">
                <span className="font-display text-sm leading-tight text-gold">your<br/>job</span>
              </div>
              <svg width="56" height="24" viewBox="0 0 56 24" className="text-gold/60" aria-hidden>
                <path d="M0 12h44M44 12l-7-6M44 12l-7 6" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-4 text-center">
                  <p className="font-display text-lg text-ivory">Studio {i}</p>
                  <p className="mt-1 text-[0.7rem] uppercase tracking-wider text-muted">verified · local</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {SERVICES.map((s) => <span key={s} className="pill">{s}</span>)}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-8">
        <p className="eyebrow">How it works</p>
        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="panel panel-hover p-6">
              <span className="font-display text-2xl text-gold/80">{s.n}</span>
              <h3 className="mt-3 text-xl text-ivory">{s.t}</h3>
              <p className="mt-2 font-sans text-sm leading-relaxed text-muted">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TWO-SIDED VALUE */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-5 md:grid-cols-2">
          <div className="panel p-8">
            <h3 className="text-2xl text-ivory">Homeowners</h3>
            <ul className="mt-4 space-y-2 font-sans text-sm text-muted">
              <li>· Free to use — you pay nothing for quotes</li>
              <li>· At most four studios, chosen for your area</li>
              <li>· Your number is shared only with matched pros</li>
            </ul>
            <Link href="/enquiry" className="btn-gold mt-6">Start an enquiry</Link>
          </div>
          <div className="panel p-8">
            <h3 className="text-2xl text-ivory">Partner studios</h3>
            <ul className="mt-4 space-y-2 font-sans text-sm text-muted">
              <li>· Prepaid lead packs — one credit per assigned lead</li>
              <li>· Leads shared with four studios at most, never resold widely</li>
              <li>· Report a bad lead within 24 hours and get the credit back</li>
            </ul>
            <Link href="/pricing" className="btn-ghost mt-6">See lead packs</Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
