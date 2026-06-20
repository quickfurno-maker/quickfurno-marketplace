import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Brand";
import { listPackages } from "@/services/packageService";

export const metadata = { title: "Lead packs — QuickFurno" };
export const dynamic = "force-dynamic";

type Pack = {
  id: string; name: string; lead_count: number; price_per_lead: number;
  total_price: number; display_price: number; validity_days: number;
};

export default async function PricingPage() {
  const res = await listPackages();
  const packs = (res.ok ? res.data : []) as Pack[];
  const popular = "Pro Pack";

  return (
    <>
      <SiteHeader />
      <section className="mx-auto max-w-6xl px-5 pt-12 pb-8">
        <p className="eyebrow">For partner studios</p>
        <h1 className="mt-4 text-3xl font-semibold text-ivory md:text-4xl">Prepaid lead packs</h1>
        <p className="mt-3 max-w-xl font-sans text-muted">
          One credit per assigned lead. Each lead goes to four studios at most — never resold to a crowd.
          Run out and you’re paused from listings until you top up.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {packs.map((p) => {
            const isPopular = p.name === popular;
            return (
              <div key={p.id} className={`panel p-6 ${isPopular ? "!border-gold/60 shadow-gold" : ""}`}>
                {isPopular && <span className="eyebrow">Most chosen</span>}
                <h3 className="mt-2 font-display text-xl text-ivory">{p.name}</h3>
                <p className="mt-4">
                  <span className="stat-num">₹{p.display_price.toLocaleString("en-IN")}</span>
                </p>
                <p className="mt-1 font-sans text-sm text-muted">
                  {p.lead_count} leads · ₹{p.price_per_lead}/lead
                </p>
                <p className="mt-1 font-sans text-xs text-muted/70">Valid {p.validity_days} days</p>
                <Link href="/vendors/register" className={`${isPopular ? "btn-gold" : "btn-ghost"} mt-6 w-full`}>
                  Apply to join
                </Link>
              </div>
            );
          })}
        </div>
        <p className="mt-8 font-sans text-xs text-muted/70">
          Payments are handled manually for now (UPI / bank transfer). After your payment is confirmed,
          credits are added to your account and you go live in listings.
        </p>
      </section>
      <SiteFooter />
    </>
  );
}
