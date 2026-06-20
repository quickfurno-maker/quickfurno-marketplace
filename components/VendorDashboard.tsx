"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { vendorUpdateLeadStatus, vendorReportBadLead } from "@/app/actions";
import type { VendorDashboardStats, VendorLeadStatus } from "@/lib/types";

const STATUSES: VendorLeadStatus[] = ["New", "Contacted", "Site Visit Scheduled", "Quotation Sent", "Won", "Lost"];

type Lead = {
  id: string; assigned_at: string; assignment_type: string; vendor_status: VendorLeadStatus; is_bad_lead_reported: boolean;
  lead: { id: string; name: string; phone: string; city: string; area: string | null; service_required: string; budget: string | null; property_type: string | null; timeline: string | null; message: string | null; created_at: string } | null;
};

export function VendorDashboard({
  vendorId, status, stats, leads,
}: { vendorId: string; status: string; stats: VendorDashboardStats; leads: Lead[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);

  async function changeStatus(assignmentId: string, s: VendorLeadStatus) {
    setBusyId(assignmentId);
    await vendorUpdateLeadStatus(vendorId, assignmentId, s);
    setBusyId(null);
    router.refresh();
  }

  async function report(assignmentId: string, reason: string) {
    setBusyId(assignmentId);
    const res = await vendorReportBadLead(vendorId, assignmentId, reason);
    setBusyId(null); setReporting(null);
    if (!res.ok) alert(res.error); else router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold text-ivory">Your leads</h1>
        <p className="mt-1 font-sans text-sm text-muted">
          Studio status: <span className={status === "Approved" ? "text-gold" : "text-muted"}>{status}</span>
        </p>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Credits left" value={stats.remaining_credits} highlight />
        <Stat label="Total leads" value={stats.total_leads} />
        <Stat label="In progress" value={stats.in_progress} />
        <Stat label="Won" value={stats.won} />
      </div>

      {stats.remaining_credits === 0 && (
        <p className="rounded-lg border border-gold/30 bg-gold/10 px-4 py-3 font-sans text-sm text-gold">
          You’re out of credits and paused from new listings. Top up a lead pack to go live again.
        </p>
      )}

      {/* leads */}
      <div className="space-y-4">
        {leads.length === 0 && (
          <div className="panel p-8 text-center font-sans text-sm text-muted">
            No leads yet. Once you’re approved and credited, matched enquiries appear here.
          </div>
        )}

        {leads.map((a) => {
          const l = a.lead;
          if (!l) return null;
          return (
            <div key={a.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-lg text-ivory">{l.name} · {l.service_required}</h3>
                  <p className="mt-0.5 font-sans text-sm text-muted">
                    {l.city}{l.area ? ` · ${l.area}` : ""} · <a href={`tel:${l.phone}`} className="text-gold hover:underline">{l.phone}</a>
                  </p>
                </div>
                <span className="pill">{a.assignment_type === "client_selected" ? "Chosen by client" : a.assignment_type === "admin_assigned" ? "Admin assigned" : "Auto-matched"}</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 font-sans text-xs text-muted">
                {l.budget && <span className="pill">{l.budget}</span>}
                {l.property_type && <span className="pill">{l.property_type}</span>}
                {l.timeline && <span className="pill">{l.timeline}</span>}
              </div>
              {l.message && <p className="mt-3 font-sans text-sm text-muted/90">“{l.message}”</p>}

              <div className="mt-4 hairline pt-4">
                <span className="label">Update status</span>
                <div className="flex flex-wrap gap-2">
                  {STATUSES.map((s) => (
                    <button key={s} disabled={busyId === a.id} onClick={() => changeStatus(a.id, s)}
                      className={`pill ${a.vendor_status === s ? "chip-on" : ""}`}>{s}</button>
                  ))}
                </div>

                <div className="mt-4">
                  {a.is_bad_lead_reported ? (
                    <span className="font-sans text-xs text-muted/70">Bad-lead report submitted.</span>
                  ) : reporting === a.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {["Wrong number", "Not interested", "Out of area", "Spam"].map((r) => (
                        <button key={r} disabled={busyId === a.id} onClick={() => report(a.id, r)} className="pill">{r}</button>
                      ))}
                      <button onClick={() => setReporting(null)} className="font-sans text-xs text-muted">cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setReporting(a.id)} className="font-sans text-xs text-muted underline-offset-2 hover:text-gold hover:underline">
                      Report a bad lead (within 24h)
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`panel p-5 ${highlight ? "!border-gold/40" : ""}`}>
      <p className={`font-display text-3xl font-semibold ${highlight ? "text-gold" : "text-ivory"}`}>{value}</p>
      <p className="mt-1 font-sans text-xs uppercase tracking-wider text-muted">{label}</p>
    </div>
  );
}
