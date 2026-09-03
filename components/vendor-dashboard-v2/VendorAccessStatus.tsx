import Link from "next/link";
import type { VendorProfileSummary } from "@/lib/types";
import { VendorIcon, type VendorIconName } from "./icons";
import { VendorPanel } from "./VendorPanel";
import {
  deriveAccessFacts,
  deriveAccessState,
  type VendorAccessTone,
} from "./vendorOverviewModel";

const TONE_ICON: Record<VendorAccessTone, VendorIconName> = {
  ok: "check",
  pending: "clock",
  warn: "alert",
  blocked: "alert",
};

/**
 * One consolidated read of lead access. This single panel replaces the old
 * repeated status tiles (verification / payment / visibility) AND the separate
 * "Lead access" card, so the same facts are stated once.
 *
 * Read-only by design — none of these fields has an authorised vendor-side
 * mutation, so the panel routes to the page or person who can change them.
 */
export function VendorAccessStatus({
  vendor,
  remainingCredits,
}: {
  vendor: VendorProfileSummary;
  remainingCredits: number;
}) {
  const state = deriveAccessState(vendor, remainingCredits);
  const facts = deriveAccessFacts(vendor, remainingCredits);

  return (
    <VendorPanel title="Lead access">
      <div className="qf-vendor-v2-access-banner" data-tone={state.tone}>
        <span className="qf-vendor-v2-access-icon" aria-hidden="true">
          <VendorIcon name={TONE_ICON[state.tone]} size={18} />
        </span>
        <div>
          <p className="qf-vendor-v2-access-headline">{state.headline}</p>
          <p className="qf-vendor-v2-access-detail">{state.detail}</p>
        </div>
      </div>

      <dl className="qf-vendor-v2-factlist">
        {facts.map((fact) => (
          <div key={fact.label} className="qf-vendor-v2-fact">
            <dt>{fact.label}</dt>
            <dd data-tone={fact.tone}>{fact.value}</dd>
          </div>
        ))}
      </dl>

      <div className="qf-vendor-v2-access-actions">
        {state.actions.map((action) => (
          <Link key={action.href} href={action.href} className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet">
            {action.label}
          </Link>
        ))}
      </div>
    </VendorPanel>
  );
}
