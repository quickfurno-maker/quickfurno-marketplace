"use client";

import { useMemo, useState } from "react";
import { VendorIcon } from "../icons";
import { VendorLeadCard } from "./VendorLeadCard";
import { applyLeadSearch, summarizeLeads, type VendorLeadView } from "./leadsModel";

/**
 * Delivered lead inbox. QuickFurno does not ask vendors to maintain sales stages.
 * Vendors can view the lead, contact the client where entitled, and report a
 * genuine lead-validity problem for review.
 */
export function VendorLeadsBoard({ leads, vendorId }: { leads: VendorLeadView[]; vendorId: string }) {
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const summary = useMemo(() => summarizeLeads(leads), [leads]);
  const visible = useMemo(() => applyLeadSearch(leads, query), [leads, query]);

  const summaryTiles = [
    { key: "total", label: "Delivered leads", value: summary.total, icon: "leads" as const },
    { key: "contact", label: "Contact available", value: summary.contactAvailable, icon: "phone" as const },
    { key: "reported", label: "Validity reports", value: summary.reported, icon: "alert" as const },
  ];

  return (
    <>
      <ul className="qf-vendor-v2-leads-summary">
        {summaryTiles.map((tile) => (
          <li key={tile.key} className="qf-vendor-v2-leads-stat">
            <span className="qf-vendor-v2-leads-stat-icon" aria-hidden="true"><VendorIcon name={tile.icon} size={16} /></span>
            <span className="qf-vendor-v2-leads-stat-text"><strong>{tile.value}</strong><span>{tile.label}</span></span>
          </li>
        ))}
      </ul>

      <div className="qf-vendor-v2-leads-controls">
        <label className="qf-vendor-v2-leads-search">
          <span className="qf-vendor-v2-sr-only">Search delivered leads by client, service or area</span>
          <VendorIcon name="search" size={16} />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client, service or area" />
        </label>
      </div>

      <p className="qf-vendor-v2-leads-count" role="status">
        {visible.length === leads.length ? `${leads.length} ${leads.length === 1 ? "lead" : "leads"}` : `${visible.length} of ${leads.length} leads`}
      </p>

      {visible.length === 0 ? (
        <div className="qf-vendor-v2-empty">
          <span className="qf-vendor-v2-empty-icon" aria-hidden="true"><VendorIcon name="inbox" size={22} /></span>
          <p className="qf-vendor-v2-empty-title">No leads match this search</p>
          <p className="qf-vendor-v2-empty-message">Clear the search to see every lead delivered to you.</p>
          <button type="button" className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet" onClick={() => setQuery("")}>Show all leads</button>
        </div>
      ) : (
        <ul className="qf-vendor-v2-leads-list">
          {visible.map((lead) => (
            <VendorLeadCard key={lead.id} lead={lead} vendorId={vendorId} expanded={expandedId === lead.id} onToggle={() => setExpandedId((current) => current === lead.id ? null : lead.id)} />
          ))}
        </ul>
      )}
    </>
  );
}
