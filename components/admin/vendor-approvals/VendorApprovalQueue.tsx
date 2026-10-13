"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminApproveVendorProfileChangeRequest, adminRejectVendorProfileChangeRequest } from "@/app/actions";
import type { VendorProfileChangeRequest } from "@/services/vendorProfileChangeService";

const FIELDS: Array<[string,string,string]> = [
  ["Business name","business_name","public_business_name"],
  ["Description","public_description","public_description"],
  ["Category","selected_category","public_category"],
  ["Services","service_categories","services_offered"],
  ["Starting price","starting_price","starting_price"],
  ["Hours","public_business_hours","business_hours"],
  ["Public service area","public_service_area_summary","service_area_summary"],
  ["Profile image","profile_image_url","profile_image_url"],
  ["Cover image","cover_image_url","cover_image_url"],
  ["Portfolio","portfolio_urls","portfolio_image_urls"],
];
const OFFICE_FIELDS: Array<[string,string,string]> = [
  ["Google Place","google_place_id","google_place_id"],
  ["Latitude","office_latitude","latitude"],
  ["Longitude","office_longitude","longitude"],
  ["Verification","location_verification_status","google_city"],
];
function printable(v: unknown) {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "string") return v.slice(0,700);
  return String(v).slice(0,700);
}
export function VendorApprovalQueue({requests, loadError}: {
  requests: VendorProfileChangeRequest[]; loadError: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [notes,setNotes] = useState<Record<string,string>>({});
  const [done,setDone] = useState<string[]>([]);
  const [feedback,setFeedback] = useState("");
  const pending = requests.filter(r => !done.includes(r.id) && (filter === "all" || r.request_type === filter));

  async function decide(req: VendorProfileChangeRequest, approve: boolean) {
    if (busy || loadError) return;
    const note = (notes[req.id] ?? "").trim();
    if (!approve && !note) { setFeedback("A rejection reason is required."); return; }
    if (approve && req.request_type !== "profile_update") {
      setFeedback("Office changes require independent Google verification. Final approval is unavailable until that integration is certified."); return;
    }
    if (approve && !window.confirm("Apply the reviewed public-profile changes?")) return;
    setBusy(req.id);setFeedback("");
    try {
      const result = approve ? await adminApproveVendorProfileChangeRequest(req.id,note)
        : await adminRejectVendorProfileChangeRequest(req.id,note);
      if (!result.ok) { setFeedback("Not applied. It may be stale, already reviewed, or require a database migration. Refresh and review."); return; }
      setDone(prev => [...prev,req.id]);
      setFeedback(approve ? "Approved and applied through Core." : "Rejected. Existing profile was preserved.");
      router.refresh();
    } catch {
      setFeedback("Review failed. Refresh before retrying.");
    } finally {setBusy(null);}
  }
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Vendor change approval inbox</h2>
            <p className="mt-1 text-sm text-slate-600">Review proposed changes before they enter the approved public profile. The existing canonical Core workflow remains authoritative.</p></div>
          <Link href="/admin/vendors" className="rounded-lg border border-slate-300 px-3 py-2 text-sm">Vendor directory</Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Request filters">
          {([["all","All"],["profile_update","Profile"],["office_location_change","Google office"]] as const).map(([value,label]) =>
            <button type="button" key={value} onClick={() => setFilter(value)} aria-pressed={filter === value}
              className={filter === value ? "rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white" : "rounded-lg border border-slate-200 px-3 py-2 text-sm"}>{label}</button>)}
        </div>
        <p className="mt-3 text-xs text-slate-500">Shows up to 100 oldest pending vendor profile/location requests. Initial vendor applications are managed separately.</p>
      </section>
      {feedback && <p className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm" role="status">{feedback}</p>}
      {loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3">Approval queue unavailable. No actions are permitted.</p>}
      {!loadError && !pending.length && <p className="rounded-lg border bg-white p-5 text-sm">No pending requests in this filter.</p>}
      {!loadError && pending.map(req => {
        const office = req.request_type === "office_location_change";
        const current = req.current_snapshot ?? {};
        const proposed = req.proposed_changes ?? {};
        const fields = (office ? OFFICE_FIELDS : FIELDS).filter(([, , k]) => Object.prototype.hasOwnProperty.call(proposed,k));
        return <article key={req.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap justify-between gap-3"><div>
            <h3 className="font-semibold">{office ? "Office location verification" : "Public profile change"}</h3>
            <p className="mt-1 break-all text-xs text-slate-500">Vendor: {req.vendor_id} · Request: {req.id}</p>
            <p className="text-xs text-slate-500">Submitted: {req.created_at ? new Date(req.created_at).toLocaleString() : "Unknown"}</p>
          </div><span className="h-fit rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900">Pending</span></div>
          {office && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Requires server-side Google Place Details and zone verification. Approval remains disabled during inactive Google API testing.</p>}
          <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm">
            <thead><tr className="border-b text-slate-500"><th className="p-2">Field</th><th className="p-2">Approved</th><th className="p-2">Requested</th></tr></thead>
            <tbody>{fields.map(([label,oldKey,newKey]) => <tr key={newKey} className="border-b align-top">
              <th className="p-2 font-medium">{label}</th>
              <td className="max-w-48 break-words p-2">{printable(current[oldKey])}</td>
              <td className="max-w-48 break-words p-2 font-semibold">{printable(proposed[newKey])}</td></tr>)}</tbody>
          </table></div>
          {fields.length === 0 && <p role="alert" className="mt-2 text-sm text-red-800">Unsupported or empty changes. Approval disabled.</p>}
          <label htmlFor={"review-" + req.id} className="mt-4 block text-sm font-medium">Admin note / rejection reason</label>
          <textarea id={"review-" + req.id} rows={2} maxLength={2000} value={notes[req.id] ?? ""}
            onChange={e => setNotes(s => ({...s,[req.id]:e.target.value}))}
            className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-sm" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={!!busy || office || fields.length === 0}
              onClick={() => void decide(req,true)}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Approve reviewed changes</button>
            <button type="button" disabled={!!busy} onClick={() => void decide(req,false)}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-40">Reject with reason</button>
          </div>
        </article>;
      })}
    </div>
  );
}
