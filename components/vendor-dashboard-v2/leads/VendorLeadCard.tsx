"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { vendorRecordClientResponseFromForm } from "@/app/actions";
import { VendorLeadReportForm } from "@/components/vendors/VendorLeadReportForm";
import { VendorIcon } from "../icons";
import type { VendorLeadView } from "./leadsModel";

/**
 * One lead in the inbox: a compact scannable row that expands in place.
 *
 * The collapsed row carries only what is needed to triage — who, what, where,
 * how much, how old, and one contact action. Everything else (the
 * enquiry message, project details, and lead-validity report) lives
 * in the expansion, so the list stays scannable and no row shows seven status
 * buttons or an open report form.
 *
 * Expansion is an in-place accordion rather than a dialog or a new route: it
 * needs no focus trap, no scroll lock and no second authority path, and it
 * behaves identically on a phone and a laptop.
 */
export function VendorLeadCard({
  lead,
  vendorId,
  expanded,
  onToggle,
}: {
  lead: VendorLeadView;
  vendorId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const panelId = `qf-lead-panel-${lead.id}`;
  const headerId = `qf-lead-head-${lead.id}`;
  // QF-MVP-80.15C — entitlement travels WITH the lead, not with the vendor. A
  // charged assignment stays readable even after the package lapsed or the
  // wallet hit zero, so this can differ from one card to the next.
  const contactAllowed = lead.contactAllowed;
  const [clockNow, setClockNow] = useState(() => Date.now());
  const connectionExpiryMs = lead.connectionWindowExpiresAt
    ? new Date(lead.connectionWindowExpiresAt).getTime()
    : Number.NaN;
  const connectionWindowOpen =
    lead.connectionAssuranceSupported &&
    lead.connectionOutcome === null &&
    Number.isFinite(connectionExpiryMs) &&
    clockNow <= connectionExpiryMs;

  useEffect(() => {
    if (!connectionWindowOpen) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [connectionWindowOpen]);

  const connectionTimeLabel = formatConnectionWindow(connectionExpiryMs, clockNow);

  return (
    <li className="qf-vendor-v2-leads-card" data-expanded={expanded ? "true" : undefined}>
      <div className="qf-vendor-v2-leads-card-main">
        <div className="qf-vendor-v2-leads-card-body">
          <div className="qf-vendor-v2-leads-card-title" id={headerId}>
            <h3>{lead.name}</h3>
            <span className="qf-vendor-v2-leads-status">Delivered lead</span>
          </div>

          <p className="qf-vendor-v2-leads-card-service">{lead.service}</p>

          {/* One wrapping meta row. The source badge rides along here rather
              than claiming a line of its own: it is secondary information, and
              a separate row cost every card ~28px of height. */}
          <ul className="qf-vendor-v2-leads-card-meta">
            <li>
              <VendorIcon name="pin" size={14} />
              {lead.place}
            </li>
            {lead.budget ? <li>Budget {lead.budget}</li> : null}
            {lead.assignedAgo ? (
              <li>
                <VendorIcon name="clock" size={14} />
                {lead.assignedAgo}
              </li>
            ) : null}
            {lead.source ? (
              <li>
                <span className="qf-vendor-v2-leads-source" data-tone={lead.source.tone}>
                  {lead.source.label}
                </span>
              </li>
            ) : null}
            {lead.isReported ? (
              <li>
                <span className="qf-vendor-v2-leads-reported">
                  <VendorIcon name="alert" size={13} />
                  Reported — under review
                </span>
              </li>
            ) : null}
          </ul>
        </div>

        <div className="qf-vendor-v2-leads-card-actions">
          {lead.phone ? (
            <a className="qf-vendor-v2-btn qf-vendor-v2-btn--primary" href={`tel:${lead.phone}`}>
              <VendorIcon name="phone" size={16} />
              Call client
            </a>
          ) : null}
          <button
            type="button"
            className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet qf-vendor-v2-leads-toggle"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggle}
          >
            {expanded ? "Close" : "Manage"}
            <VendorIcon name={expanded ? "close" : "arrow-right"} size={15} />
          </button>
        </div>
      </div>

      <section className="qf-vendor-v2-connection-check" aria-label={`Client response check for ${lead.name}`}>
        <div className="qf-vendor-v2-connection-copy">
          <strong>Did the client respond?</strong>
          {lead.connectionOutcome === "responded" ? (
            <span>Recorded: Client responded. No QuickFurno connection reminders will run.</span>
          ) : lead.connectionOutcome === "no_response" ? (
            <span>Recorded: No response. QuickFurno is handling the bounded client connection-assistance sequence.</span>
          ) : !lead.connectionAssuranceSupported ? (
            <span>Connection check is not active on this environment yet.</span>
          ) : connectionWindowOpen ? (
            <span>Available only during the first 24 hours after lead delivery - {connectionTimeLabel}</span>
          ) : (
            <span>24-hour response window closed. This option is now read-only.</span>
          )}
        </div>
        <form action={vendorRecordClientResponseFromForm} className="qf-vendor-v2-connection-actions">
          <input type="hidden" name="assignmentId" value={lead.id} />
          <button type="submit" name="outcome" value="responded" disabled={!connectionWindowOpen}>
            Yes, responded
          </button>
          <button type="submit" name="outcome" value="no_response" disabled={!connectionWindowOpen}>
            No response
          </button>
        </form>
      </section>

      {expanded ? (
        <div className="qf-vendor-v2-leads-detail" id={panelId} role="region" aria-labelledby={headerId}>
          <section className="qf-vendor-v2-leads-detail-block">
            <h4>Requirement</h4>
            <dl className="qf-vendor-v2-leads-detail-list">
              <div>
                <dt>Service</dt>
                <dd>{lead.service}</dd>
              </div>
              <div>
                <dt>Area / city</dt>
                <dd>{lead.place}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>{lead.budget ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Property type</dt>
                <dd>{lead.propertyType ?? "Not set"}</dd>
              </div>
              <div>
                <dt>Timeline</dt>
                <dd>{lead.timeline ?? "Not set"}</dd>
              </div>
            </dl>
            {lead.message ? (
              <blockquote className="qf-vendor-v2-leads-message">{lead.message}</blockquote>
            ) : null}
          </section>

          <section className="qf-vendor-v2-leads-detail-block">
            <h4>Contact</h4>
            {lead.phone ? (
              <div className="qf-vendor-v2-leads-contact">
                <a href={`tel:${lead.phone}`} className="qf-vendor-v2-leads-phone">
                  <VendorIcon name="phone" size={16} />
                  {lead.phone}
                </a>
              </div>
            ) : (
              <p className="qf-vendor-v2-leads-locked">
                <VendorIcon name="lock" size={15} />
                Client contact is unavailable for this assignment. Contact QuickFurno support if you
                believe this lead was charged.
              </p>
            )}
          </section>

          {contactAllowed ? (
            <>

              <section className="qf-vendor-v2-leads-detail-block">
                <h4>Lead validity issue</h4>
                {lead.isReported ? (
                  <p className="qf-vendor-v2-leads-note">
                    Reported — under review. An admin will look at this report. Lead credit is not
                    refunded automatically.
                  </p>
                ) : (
                  <>
                    <p className="qf-vendor-v2-leads-note">
                      Report only genuine lead-validity problems such as an invalid number, duplicate, or materially incorrect lead details. QuickFurno does not review quotation, site visit, negotiation, or sale outcomes. Lead credit is not refunded automatically.
                    </p>
                    {/* Unchanged component, unchanged action. Only the surrounding
                        chrome is restyled, via the scoped wrapper class. */}
                    <div className="qf-vendor-v2-leads-report">
                      <VendorLeadReportForm vendorId={vendorId} assignmentId={lead.id} />
                    </div>
                  </>
                )}
              </section>
            </>
          ) : (
            <section className="qf-vendor-v2-leads-detail-block">
              <h4>Lead support</h4>
              <p className="qf-vendor-v2-leads-note">
                Lead-validity reporting is unavailable for this assignment. Contact QuickFurno support if you believe this lead was charged incorrectly.
              </p>
              <Link
                href="/vendor/dashboard/support"
                className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
              >
                Contact support
              </Link>
            </section>
          )}
        </div>
      ) : null}
    </li>
  );
}

function formatConnectionWindow(expiryMs: number, nowMs: number): string {
  if (!Number.isFinite(expiryMs)) return "Window unavailable";
  const remainingMs = Math.max(0, expiryMs - nowMs);
  if (remainingMs === 0) return "Window closed";
  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m remaining`;
  if (hours > 0) return `${hours}h remaining`;
  return `${minutes}m remaining`;
}
