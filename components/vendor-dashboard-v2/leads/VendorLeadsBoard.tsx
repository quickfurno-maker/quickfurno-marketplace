"use client";

import { useMemo, useState } from "react";
import { VendorIcon } from "../icons";
import { VendorLeadCard } from "./VendorLeadCard";
import {
  applyLeadFilter,
  buildFilterOptions,
  summarizeLeads,
  type VendorLeadFilterKey,
  type VendorLeadView,
} from "./leadsModel";

/**
 * The lead inbox: summary counts, filters, local search and the list itself.
 *
 * Client-side because filtering, searching and expanding are local interactions
 * — none of them touches the server. Filtering is presentation-only over rows
 * already loaded by vendorLeads(); there is no new query, no new index and no
 * pagination contract.
 *
 * Every `VendorLeadView` handed to this component has already been stripped of
 * the client's email, and of the client's phone unless the server proved contact
 * access FOR THAT ASSIGNMENT. Entitlement is per row (QF-MVP-80.15C), so this
 * component passes none of its own: each card reads `lead.contactAllowed`. See
 * buildVendorLeadViews().
 */
export function VendorLeadsBoard({
  leads,
  vendorId,
}: {
  leads: VendorLeadView[];
  vendorId: string;
}) {
  const [filter, setFilter] = useState<VendorLeadFilterKey>("all");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const summary = useMemo(() => summarizeLeads(leads), [leads]);
  const filterOptions = useMemo(() => buildFilterOptions(leads), [leads]);
  const visible = useMemo(() => applyLeadFilter(leads, filter, query), [leads, filter, query]);

  const summaryTiles = [
    { key: "total", label: "Assigned", value: summary.total, icon: "leads" as const },
    { key: "new", label: "New", value: summary.fresh, icon: "bell" as const },
    { key: "followup", label: "Follow-up", value: summary.followUp, icon: "clock" as const },
    { key: "converted", label: "Converted", value: summary.converted, icon: "check" as const },
  ];

  return (
    <>
      <ul className="qf-vendor-v2-leads-summary">
        {summaryTiles.map((tile) => (
          <li key={tile.key} className="qf-vendor-v2-leads-stat">
            <span className="qf-vendor-v2-leads-stat-icon" aria-hidden="true">
              <VendorIcon name={tile.icon} size={16} />
            </span>
            <span className="qf-vendor-v2-leads-stat-text">
              <strong>{tile.value}</strong>
              <span>{tile.label}</span>
            </span>
          </li>
        ))}
      </ul>

      <div className="qf-vendor-v2-leads-controls">
        <div
          className="qf-vendor-v2-leads-filters"
          role="tablist"
          aria-label="Filter leads by status"
        >
          {filterOptions.map((option) => {
            const active = option.key === filter;
            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={active}
                className="qf-vendor-v2-leads-chip"
                data-active={active ? "true" : undefined}
                onClick={() => {
                  setFilter(option.key);
                  setExpandedId(null);
                }}
              >
                {option.label}
                <span className="qf-vendor-v2-leads-chip-count">{option.count}</span>
              </button>
            );
          })}
        </div>

        <label className="qf-vendor-v2-leads-search">
          <span className="qf-vendor-v2-sr-only">Search leads by client, service or area</span>
          <VendorIcon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search client, service or area"
          />
        </label>
      </div>

      <p className="qf-vendor-v2-leads-count" role="status">
        {visible.length === leads.length
          ? `${leads.length} ${leads.length === 1 ? "lead" : "leads"}`
          : `${visible.length} of ${leads.length} leads`}
      </p>

      {visible.length === 0 ? (
        <div className="qf-vendor-v2-empty">
          <span className="qf-vendor-v2-empty-icon" aria-hidden="true">
            <VendorIcon name="inbox" size={22} />
          </span>
          <p className="qf-vendor-v2-empty-title">No leads match this view</p>
          <p className="qf-vendor-v2-empty-message">
            Try a different status filter, or clear the search to see every assigned lead.
          </p>
          <button
            type="button"
            className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
            onClick={() => {
              setFilter("all");
              setQuery("");
            }}
          >
            Show all leads
          </button>
        </div>
      ) : (
        <ul className="qf-vendor-v2-leads-list">
          {visible.map((lead) => (
            <VendorLeadCard
              key={lead.id}
              lead={lead}
              vendorId={vendorId}
              expanded={expandedId === lead.id}
              onToggle={() => setExpandedId((current) => (current === lead.id ? null : lead.id))}
            />
          ))}
        </ul>
      )}
    </>
  );
}
