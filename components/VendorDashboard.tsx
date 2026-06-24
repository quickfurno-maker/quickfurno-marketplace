"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { vendorUpdateLeadStatus, vendorReportBadLead } from "@/app/actions";
import { whatsappLink, CONTACT_TEL } from "@/lib/config";
import type { VendorDashboardStats, VendorLeadStatus, VendorProfileSummary } from "@/lib/types";

const STATUSES: VendorLeadStatus[] = ["New", "Contacted", "Site Visit Scheduled", "Quotation Sent", "Won", "Lost"];

type Lead = {
  id: string; assigned_at: string; assignment_type: string; vendor_status: VendorLeadStatus; is_bad_lead_reported: boolean;
  lead: { id: string; name: string; phone: string; city: string; area: string | null; service_required: string; budget: string | null; property_type: string | null; timeline: string | null; message: string | null; created_at: string } | null;
};

export function VendorDashboard({
  vendor, stats, leads,
}: { vendor: VendorProfileSummary; stats: VendorDashboardStats; leads: Lead[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);

  const isVerified = vendor.verification_status === "Verified" || vendor.status === "Approved";
  const isPaid = (vendor.paid_status ?? "Unpaid") === "Paid";
  const verificationLabel = vendor.verification_status || vendor.status || "Pending";
  const paymentLabel = vendor.paid_status || "Unpaid";
  const serviceAreas = (vendor.areas_covered ?? []).filter(Boolean);
  const categoryLabel = vendor.selected_category || (vendor.service_categories ?? [])[0] || "—";
  const whatsapp = vendor.whatsapp_number || vendor.phone || "";

  // Business location — only rendered when an address was captured at onboarding.
  const addressLine = [vendor.office_address_line1, vendor.office_address_line2, vendor.office_landmark]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");
  const cityStatePin = [
    [vendor.office_city || vendor.city, vendor.office_state].map((p) => p?.trim()).filter(Boolean).join(", "),
    vendor.office_pincode?.trim() ? `- ${vendor.office_pincode.trim()}` : "",
  ].filter(Boolean).join(" ");
  const hasAddress = Boolean(addressLine || vendor.office_pincode?.trim());
  const mapHref =
    vendor.office_latitude != null && vendor.office_longitude != null
      ? `https://www.google.com/maps?q=${vendor.office_latitude},${vendor.office_longitude}`
      : null;

  async function changeStatus(assignmentId: string, s: VendorLeadStatus) {
    setBusyId(assignmentId);
    await vendorUpdateLeadStatus(vendor.id, assignmentId, s);
    setBusyId(null);
    router.refresh();
  }

  async function report(assignmentId: string, reason: string) {
    setBusyId(assignmentId);
    const res = await vendorReportBadLead(vendor.id, assignmentId, reason);
    setBusyId(null); setReporting(null);
    if (!res.ok) alert(res.error); else router.refresh();
  }

  const supportHref = whatsappLink(
    `Hi QuickFurno team, this is ${vendor.business_name}. I have a question about my vendor dashboard.`,
  );

  return (
    <div className="qf-vd-page">
      {/* Welcome */}
      <section className="qf-vd-card qf-vd-welcome" id="welcome">
        <div>
          <h1>Welcome to your QuickFurno Vendor Dashboard</h1>
          <p>
            {isVerified
              ? "Your profile is verified. Matched client enquiries will appear in your leads below."
              : "Your profile is under review. Our team will verify your details before activating lead access."}
          </p>
        </div>
        <span className={`qf-vd-chip ${isVerified ? "qf-vd-chip--ok" : "qf-vd-chip--pending"}`}>
          {isVerified ? "Verified" : "Under review"}
        </span>
      </section>

      {/* Status cards */}
      <section className="qf-vd-stat-grid" id="status">
        <StatCard label="Verification Status" value={verificationLabel} tone={isVerified ? "ok" : "pending"} />
        <StatCard label="Payment Status" value={paymentLabel} tone={isPaid ? "ok" : "neutral"} />
        <StatCard label="Profile Visibility" value={vendor.public_visibility ? "Visible" : "Hidden"} tone={vendor.public_visibility ? "ok" : "neutral"} />
        <StatCard label="Remaining Leads / Credits" value={String(stats.remaining_credits)} tone="blue" />
        <StatCard label="Assigned Leads" value={String(stats.total_leads)} tone="blue" />
        <StatCard label="Response Rate" value={stats.total_leads > 0 ? `${Math.round(((stats.total_leads - stats.in_progress) / stats.total_leads) * 100)}%` : "—"} tone="neutral" />
      </section>

      <div className="qf-vd-columns">
        <div className="qf-vd-col">
          {/* Lead access */}
          <section className="qf-vd-card" id="lead-access">
            <h2 className="qf-vd-card-title">Lead access</h2>
            {!isVerified ? (
              <p className="qf-vd-note qf-vd-note--pending">
                Your profile is under verification. Lead access will be enabled after approval.
              </p>
            ) : !isPaid ? (
              <p className="qf-vd-note">
                Package details will be shared after verification.
              </p>
            ) : (
              <p className="qf-vd-note qf-vd-note--ok">
                Lead access is active. New matched enquiries will appear in your leads.
              </p>
            )}
          </section>

          {/* Assigned leads */}
          <section className="qf-vd-card" id="leads">
            <h2 className="qf-vd-card-title">Assigned leads</h2>

            {leads.length === 0 ? (
              <div className="qf-vd-empty">
                <span className="qf-vd-empty-icon" aria-hidden="true">📭</span>
                <p>
                  No leads assigned yet. Once your profile is verified and lead access is active,
                  client enquiries will appear here.
                </p>
              </div>
            ) : (
              <div className="qf-vd-leads">
                {leads.map((a) => {
                  const l = a.lead;
                  if (!l) return null;
                  return (
                    <article key={a.id} className="qf-vd-lead">
                      <div className="qf-vd-lead-head">
                        <div>
                          <strong>{l.name}</strong>
                          <span>{l.service_required}</span>
                        </div>
                        <span className="qf-vd-lead-status" data-status={a.vendor_status}>{a.vendor_status}</span>
                      </div>
                      <dl className="qf-vd-lead-meta">
                        <div><dt>Area</dt><dd>{[l.area, l.city].filter(Boolean).join(", ") || l.city}</dd></div>
                        <div><dt>Budget</dt><dd>{l.budget || "—"}</dd></div>
                        {l.timeline ? <div><dt>Timeline</dt><dd>{l.timeline}</dd></div> : null}
                      </dl>
                      {l.message ? <p className="qf-vd-lead-msg">“{l.message}”</p> : null}

                      <div className="qf-vd-lead-actions">
                        <a className="qf-vd-btn qf-vd-btn--primary" href={`tel:${l.phone}`}>Call client</a>
                        <a
                          className="qf-vd-btn qf-vd-btn--ghost"
                          href={whatsappLink(`Hi ${l.name}, this is ${vendor.business_name} from QuickFurno regarding your ${l.service_required} requirement.`)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          WhatsApp
                        </a>
                      </div>

                      <div className="qf-vd-lead-foot">
                        <span className="qf-vd-mini-label">Update status</span>
                        <div className="qf-vd-pills">
                          {STATUSES.map((s) => (
                            <button
                              key={s}
                              type="button"
                              disabled={busyId === a.id}
                              onClick={() => changeStatus(a.id, s)}
                              className={`qf-vd-pill${a.vendor_status === s ? " is-on" : ""}`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        <div className="qf-vd-report">
                          {a.is_bad_lead_reported ? (
                            <span className="qf-vd-report-done">Bad-lead report submitted.</span>
                          ) : reporting === a.id ? (
                            <div className="qf-vd-pills">
                              {["Wrong number", "Not interested", "Out of area", "Spam"].map((r) => (
                                <button key={r} type="button" disabled={busyId === a.id} onClick={() => report(a.id, r)} className="qf-vd-pill">{r}</button>
                              ))}
                              <button type="button" onClick={() => setReporting(null)} className="qf-vd-link">cancel</button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setReporting(a.id)} className="qf-vd-link">
                              Report a bad lead (within 24h)
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="qf-vd-col">
          {/* Profile summary */}
          <section className="qf-vd-card" id="profile">
            <h2 className="qf-vd-card-title">Profile summary</h2>
            <dl className="qf-vd-profile">
              <ProfileRow label="Business name" value={vendor.business_name} />
              <ProfileRow label="Owner name" value={vendor.owner_name || "—"} />
              <ProfileRow label="WhatsApp" value={whatsapp || "—"} />
              <ProfileRow label="Email" value={vendor.email || "—"} />
              <ProfileRow label="City" value={vendor.city || "—"} />
              <ProfileRow label="Service areas" value={serviceAreas.length ? serviceAreas.join(", ") : "—"} />
              <ProfileRow label="Category" value={categoryLabel} />
              <ProfileRow label="Business type" value={vendor.business_type || "—"} />
            </dl>
          </section>

          {/* Business location */}
          {hasAddress ? (
            <section className="qf-vd-card" id="location">
              <h2 className="qf-vd-card-title">Business Location</h2>
              <address className="qf-vd-address">
                <span className="qf-vd-address-icon" aria-hidden="true">📍</span>
                <span className="qf-vd-address-text">
                  {addressLine ? <span>{addressLine}</span> : null}
                  {cityStatePin ? <span>{cityStatePin}</span> : null}
                </span>
              </address>
              {mapHref ? (
                <a className="qf-vd-link" href={mapHref} target="_blank" rel="noopener noreferrer">
                  View on map
                </a>
              ) : null}
            </section>
          ) : null}

          {/* Visibility */}
          <section className="qf-vd-card" id="visibility">
            <h2 className="qf-vd-card-title">Profile visibility</h2>
            <div className="qf-vd-toggle-row">
              <div>
                <strong className="qf-vd-toggle-state">
                  {vendor.public_visibility ? "Visible to clients" : "Hidden from clients"}
                </strong>
                <p className="qf-vd-note">
                  {isVerified
                    ? "Visibility is managed by QuickFurno based on your approval and active lead access."
                    : "Profile visibility can be managed after verification."}
                </p>
              </div>
              <span
                className={`qf-vd-switch${vendor.public_visibility ? " is-on" : ""}${!isVerified ? " is-disabled" : ""}`}
                role="img"
                aria-label={vendor.public_visibility ? "Visible" : "Hidden"}
              >
                <span className="qf-vd-switch-knob" />
              </span>
            </div>
          </section>

          {/* Support */}
          <section className="qf-vd-card qf-vd-support" id="support">
            <h2 className="qf-vd-card-title">Need help?</h2>
            <p className="qf-vd-note">Our team is one message away for onboarding and lead questions.</p>
            <a className="qf-vd-btn qf-vd-btn--primary qf-vd-btn--full" href={supportHref} target="_blank" rel="noopener noreferrer">
              Chat with QuickFurno Team
            </a>
            <a className="qf-vd-btn qf-vd-btn--ghost qf-vd-btn--full" href={CONTACT_TEL}>Call support</a>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone: "ok" | "pending" | "neutral" | "blue" }) {
  return (
    <div className={`qf-vd-stat qf-vd-stat--${tone}`}>
      <span className="qf-vd-stat-label">{label}</span>
      <strong className="qf-vd-stat-value">{value}</strong>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
