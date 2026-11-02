# VOX-16D Staff Vendor 360 — pending canonical profile reviews

Adds a bounded **GET-only** server BFF, client refresh UI, and default-OFF `VOX_VENDOR_PROFILE_REVIEW_UI_ENABLED=staging`. Only a currently authenticated Supabase AAL2 staff session can request the assigned vendor's Core `/api/vox/v1/vendor-profile-review` route. The existing Core authoritative endpoint rechecks active staff/team/city/vendor/location scope and returns pending native `vendor_profile_change_requests` references. Staff Web drops unknown Core fields and accepts exactly the narrow non-executable response.

No proposed JSON changes, snapshots, personal data, Aadhaar/KYC or provider messages travel to the UI. Vendor-profile updates still require the existing separate atomic Core v3 approval; office location changes remain fail-closed pending server-verifiable Google Places proof. Do not confuse this review list with a fully executed, signed or live staging workflow.
