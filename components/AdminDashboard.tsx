"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminApproveVendor, adminRejectVendor, adminSuspendVendor,
  adminCreditVendorNow, adminApproveBadLead, adminRejectBadLead,
} from "@/app/actions";
import type { AdminDashboardStats } from "@/lib/types";

type Vendor = { id: string; business_name: string; city: string; status: string; remaining_credits: number; total_credits: number; public_visibility: boolean; phone: string };
type Pack = { id: string; name: string; total_price: number };
type Report = { id: string; reason: string; description: string | null; vendor: { business_name: string } | null; assignment: { lead: { name: string; service_required: string; city: string } | null } | null };

type Tab = "vendors" | "reports";

export function AdminDashboard({
  stats, vendors, packages, reports,
}: { stats: AdminDashboardStats; vendors: Vendor[]; packages: Pack[]; reports: Report[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("vendors");
  const [busy, setBusy] = useState<string | null>(null);
  const [creditFor, setCreditFor] = useState<string | null>(null);

  async function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(id);
    const res = await fn();
    setBusy(null);
    if (!res.ok && res.error) alert(res.error);
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-semibold text-ivory">Operations</h1>

      {/* stat grid */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Total leads" value={stats.total_leads} />
        <Stat label="Assigned" value={stats.assigned_leads} />
        <Stat label="Duplicates" value={stats.duplicate_leads} />
        <Stat label="Leads distributed" value={stats.leads_distributed} />
        <Stat label="Vendors" value={stats.total_vendors} />
        <Stat label="Pending vendors" value={stats.pending_vendors} highlight={stats.pending_vendors > 0} />
        <Stat label="Credits in market" value={stats.remaining_vendor_credits} />
        <Stat label="Revenue (₹)" value={stats.total_revenue} />
      </div>

      {/* tabs */}
      <div className="flex gap-2">
        <button onClick={() => setTab("vendors")} className={`pill ${tab === "vendors" ? "chip-on" : ""}`}>Vendors</button>
        <button onClick={() => setTab("reports")} className={`pill ${tab === "reports" ? "chip-on" : ""}`}>
          Bad-lead reports{stats.bad_lead_reports_pending > 0 ? ` · ${stats.bad_lead_reports_pending}` : ""}
        </button>
      </div>

      {tab === "vendors" && (
        <div className="space-y-3">
          {vendors.map((v) => (
            <div key={v.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-ivory">{v.business_name}</h3>
                  <p className="mt-0.5 font-sans text-sm text-muted">{v.city} · {v.phone}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className={`pill ${v.status === "Approved" ? "chip-on" : ""}`}>{v.status}</span>
                    <span className="pill">{v.remaining_credits} credits</span>
                    <span className="pill">{v.public_visibility ? "Listed" : "Hidden"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {v.status !== "Approved" && <button disabled={busy === v.id} onClick={() => run(v.id, () => adminApproveVendor(v.id))} className="btn-gold !px-4 !py-2 text-xs">Approve</button>}
                  {v.status !== "Suspended" && <button disabled={busy === v.id} onClick={() => run(v.id, () => adminSuspendVendor(v.id))} className="btn-ghost !px-4 !py-2 text-xs">Suspend</button>}
                  {v.status !== "Rejected" && <button disabled={busy === v.id} onClick={() => run(v.id, () => adminRejectVendor(v.id))} className="btn-ghost !px-4 !py-2 text-xs">Reject</button>}
                  <button onClick={() => setCreditFor(creditFor === v.id ? null : v.id)} className="btn-ghost !px-4 !py-2 text-xs">Credit pack</button>
                </div>
              </div>

              {creditFor === v.id && (
                <CreditPanel vendor={v} packages={packages} busy={busy === v.id}
                  onCredit={(pkgId, amount, method, txn) => run(v.id, async () => {
                    const r = await adminCreditVendorNow(v.id, pkgId, amount, method, txn);
                    if (r.ok) setCreditFor(null);
                    return r;
                  })} />
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "reports" && (
        <div className="space-y-3">
          {reports.length === 0 && <div className="panel p-8 text-center font-sans text-sm text-muted">No pending reports.</div>}
          {reports.map((r) => (
            <div key={r.id} className="panel flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h3 className="font-display text-lg text-ivory">{r.vendor?.business_name ?? "Studio"}</h3>
                <p className="mt-0.5 font-sans text-sm text-muted">
                  {r.reason} · {r.assignment?.lead?.name ?? "lead"} ({r.assignment?.lead?.service_required}, {r.assignment?.lead?.city})
                </p>
              </div>
              <div className="flex gap-2">
                <button disabled={busy === r.id} onClick={() => run(r.id, () => adminApproveBadLead(r.id))} className="btn-gold !px-4 !py-2 text-xs">Refund credit</button>
                <button disabled={busy === r.id} onClick={() => run(r.id, () => adminRejectBadLead(r.id))} className="btn-ghost !px-4 !py-2 text-xs">Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CreditPanel({
  vendor, packages, busy, onCredit,
}: { vendor: Vendor; packages: Pack[]; busy: boolean; onCredit: (pkgId: string, amount: number, method: string, txn?: string) => void }) {
  const [pkgId, setPkgId] = useState(packages[0]?.id ?? "");
  const [method, setMethod] = useState("UPI");
  const [txn, setTxn] = useState("");
  const pack = packages.find((p) => p.id === pkgId);

  return (
    <div className="mt-4 hairline pt-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block"><span className="label">Pack</span>
          <select className="field" value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
            {packages.map((p) => <option key={p.id} value={p.id} className="bg-navy-deep">{p.name} — ₹{p.total_price.toLocaleString("en-IN")}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Method</span>
          <select className="field" value={method} onChange={(e) => setMethod(e.target.value)}>
            {["UPI", "Bank transfer", "Cash", "Card"].map((m) => <option key={m} className="bg-navy-deep">{m}</option>)}
          </select>
        </label>
        <label className="block"><span className="label">Txn ref (optional)</span>
          <input className="field" value={txn} onChange={(e) => setTxn(e.target.value)} />
        </label>
      </div>
      <button disabled={busy || !pkgId} onClick={() => onCredit(pkgId, pack?.total_price ?? 0, method, txn || undefined)} className="btn-gold mt-4 !py-2 text-xs">
        {busy ? "Crediting…" : `Confirm payment & credit ${vendor.business_name}`}
      </button>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`panel p-5 ${highlight ? "!border-gold/50 shadow-gold" : ""}`}>
      <p className={`font-display text-2xl font-semibold ${highlight ? "text-gold" : "text-ivory"}`}>
        {value.toLocaleString("en-IN")}
      </p>
      <p className="mt-1 font-sans text-xs uppercase tracking-wider text-muted">{label}</p>
    </div>
  );
}
