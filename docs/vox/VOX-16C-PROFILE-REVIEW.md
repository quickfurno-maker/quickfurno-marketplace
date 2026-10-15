# VOX-16C — Canonical vendor profile approval review

Source-only, default-off read-only projection for assigned vendor profile review queue. Reads **existing** Core `vendor_profile_change_requests` records, not a new VOX datastore. Requires Core real AAL2 staff, existing assigned vendor, live vendor and active canonical city-zone. No `proposed_changes`, `current_snapshot`, admin notes or PII returned. Maximum 20 entries. The state is `READ_ONLY`, no execution endpoint.

Existing `qf_approve_vendor_profile_update_v3` owns atomic user-visible profile updates; it is **not** invoked by this VOX route, and cannot be bypassed by mere approval of `VOX_OPERATIONAL_INTENT`. Office location change remains explicitly blocked by native Core until Google provider verification and atomically approved location change are certified. Does not send vendor notifications or change the vendor record.

P0 still needed: signed staging, reviewed data migrations, native owner/Team Leader approval matrix, correct applicant/reviewer separation, live E2E of genuine v3 Core RPC, Google Places canonical provider proof, consent and rollback. No production edits.
