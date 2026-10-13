# VOX-05 — Reuse existing Aarohi CRM + Vendor CRM

**Source-only. No new CRM tables and no production deployment.**

The original Aarohi CRM implementation is at `services/aarohiCrmService.ts` and `app/admin/aarohi/`, with canonical `aarohi_prospects`, `aarohi_tasks`, `aarohi_vendor_conversion_links` and related Core tables. These existing **global Superadmin** service methods are not safe to call wholesale from a delegated VOX staff session. This adapter deliberately reads the **same canonical tables** via `readScopedAarohi`, with verified city and prospect assignments from VOX-03, and uses a narrow shape shared with the CRM. No second Aarohi pipeline or conversion engine. The conversion link is never treated as Core vendor activation.

The original Vendor CRM remains `services/vendorCrmService.ts` using its six CRM-owned tables and Core vendor records. `readScopedVendor360` uses the same existing Core `vendors`, `marketplace_service_zones`, `vendor_crm_profiles` and `vendor_tasks`, verifying the assigned vendor **and** service-zone-city before any projection. No credits, phones, Google Place IDs, payments or profile mutation are exposed by this source route.

These are real Core route candidates `GET /api/vox/v1/acquisition` and `GET /api/vox/v1/vendor360`, using the existing VOX-03 Supabase Auth AAL2 and object/city membership checks. All writes are 405. Source contracts and checks are separately testable without privileged credentials.

**Important gap:** this is a limited, read-only staff projection, not the full existing Aarohi CRM UI/feature parity. The remaining CRM flows (detailed prospect profiles, campaign, owner task assignment, follow-up and editing) must be adapted through guarded source-owner services and approved Core action endpoints; do not copy unscoped admin pages into VOX. Staging staff grants are not installed, the earlier draft chain is unmerged and there is no genuine staff HTTP test yet.

No changes to canonical records, meta messaging provider, wallet, matching or VPS.
