# VL-03 — Core vendor journey facts for existing signed AGNI owner snapshot
Date: 13 October 2026. Source-only. No production promotion or provider canary.

## Canonical read path
`POST /api/internal/agni/owner-snapshot` already validates a bounded authenticated signed `qf.agni.owner-snapshot.v1` request with `qf-agni-control-plane` actor. Reuse the existing no-store JSON response `qf.agni.owner-snapshot.response.v1`; do not introduce a new endpoint, impersonation token, UI switch, mutable control plane or network dependency.

Eight new aggregate metrics are returned under the existing `metrics` object:
- `vendors_approved_without_login`: approved vendors with no linked canonical `user_id`.
- `vendors_approved_without_service_zone`: approved vendors with no Core zone authority.
- `vendors_accepting_leads_without_service_zone`: acceptance flag true but no Core zone. This is a **reconciliation signal**, not proof a lead was assigned or delivered.
- `vendor_google_offices_verified`: Core status exactly `verified` (polygon or other backed verification as defined by Core).
- `vendor_google_offices_provisional`: Core status exactly `provisional`; **not polygon-certified**.
- `vendor_office_change_reviews_pending`: vendor profile requests of the dedicated office-change type that are still pending.
- `active_matching_zones_missing_polygon`: active, matching-enabled zone rows without a polygon. A zero count alone cannot prove full polygon correctness, only no null boundaries.
- `vendor_paid_orders_not_activated`: orders with non-null paid timestamp and null activation timestamp. This is evidence of a reconciliation need, not automatically a failed payment or a command to grant credits.

Counts use the service-role Supabase exact count/head-only reader. Each independent source returns `{status:'AVAILABLE',value:N}` or `{status:'UNAVAILABLE',value:null}`. No vendor rows, contact details, Place IDs, memories, webhook bodies, balances or direct financial state cross the signed boundary. Failed counts NEVER become zero. Snapshot is read-only L0 evidence, not an automatic incident, alert or repair. AGNI consumer rendering and production owner receipt require separate VL-04 live acceptance.

## Certification
`npm run test:mvp:vendor-agni-readiness` executes the actual transpiled Core read function against isolated SQL-query-semantic fixtures. It certifies eight precise aggregates, source reads, PII exclusion, isolated failure/UNKNOWN and immutable output: 12/12 pass. Wired into QF MVP 50 hosted Quality Gate.

## Real-world baseline (read-only, previous observed evidence)
Core production 28 vendors, 14 approved, six approved without login, zero zone-linked, 26 `accepting_leads` flags, zero verified Google offices. Production and staging each have one active matching-enabled zone and zero configured polygons. No account, live lead, Razorpay, Meta, Anisha memory or production release changes in this slice. These remain live onboarding/provider/geo policy gates, not test fixtures to mutate.

## Next gates
Post-merge signed image / exact owner approval; real Core production deployment then authenticated AGNI owner snapshot check. Validate stale/unavailable source propagation, advisory owner alert, on-device owner receipt and recovery before VL-04 acceptance. Customer and vendor business effects remain Core-governed. No automatic lead disabling or credit grant from diagnostic counters.
