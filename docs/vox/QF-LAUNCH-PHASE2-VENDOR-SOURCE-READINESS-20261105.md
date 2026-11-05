# QuickFurno Phase 2 — Vendor Registration + Private Evidence Integrated Certification

**5 November 2026 | Single Phase 2 source candidate stacked on Phase 1 PR #492.** All changes internal. No managed Staging/Production, live provider sends, Google billing, real private vendor evidence or public enrollment. **RELEASE HOLD**.

## Source tracks implemented in parallel

### Track A — streamed request truth
- `app/api/vendor/onboarding/request-otp/route.ts`: use `readBoundedVendorJson(request,1024)` before any signed Auth OTP or purpose reservation. Strict valid JSON, rejects oversize actual stream, malformed UTF-8/length/truncation. Missing `Content-Length` is valid for HTTP/2/chunked browsers; a forged small value cannot overrun the bound.
- `app/api/vendor/onboarding/complete/route.ts`: same actual-byte limit `8192` before the existing verified-OTP + atomic Pending RPC. No client OTP or server-role bypass. No password, email signup, public vendor insert, matching or credits.
- `app/api/vendor/private-evidence/route.ts`: absent `Content-Length` no longer blocks legitimate browser multipart, but declared invalid/oversized length and actual content beyond `MAX_BODY` remain blocked. Existing bounded streaming multipart parser still runs after Auth and before private case/Storage writes, with private bucket and scanner/Owner approval separately gated. No signed public URL, no Aadhaar/PAN scan, no raw number collection.
- New six negative/positive security tests cover browser/no-length, forged small claimed length, invalid lengths, oversized JSON/malformed UTF-8, endpoint ordering and private multipart.
- The service's existing OTP signed-hook purpose reservation, rate limits, verified Auth session, delivery/evidence binding, ownership, consent, city and CAS/atomic admission are reused unchanged. No second authentication authority.

### Track B — vendor-facing truthful UX
- Frontend OTP request only exposes code entry on the *exact* HTTP 202 acknowledgment `{ok:true,code:"OTP_REQUEST_INITIATED",deliveryConfirmed:false}`. The UI explicitly states that provider delivery is unconfirmed; invalid/503/409 or forged responses fail closed. OTP input is ASCII digits only, six–eight digits required. Phone edits discard prior OTP state. No SMS/password fallback.
- Private evidence form requires a deliberate identity-method choice and separate consent, validates PDF/PNG/JPEG with 8-byte to 5MB hint, resets stale file selection when category changes and after success, disables form mutation while uploading, and confirms success only on the exact **202 Pending, approved=false, publicDocumentUrl=null** response.
- Upload errors never claim evidence was stored. The user is advised not to send identity documents via public chat. Server still enforces size, MIME magic bytes, private bucket ownership, scan quarantine and independent Owner decision; client checks never approve a vendor.
- Six unit/source tests cover fake OTP delivery, input sanitization, file boundaries, false approval/URL confirmation, and UI authority / privacy constraints.

## Existing functional guarantees to preserve
Mandatory WhatsApp mobile OTP; email/GST optional; no separate PAN data; identity and office/category evidence, no raw Aadhaar card uploads via this endpoint; enrollment Pending and inactive until Owner approval. Matching maximum three eligible vendors per lead, one lead consumes one credit; looking does not consume credits. Bad lead remedy is **restore one lead credit only**, never monetary refund. VOX Owner stays a separate interface on canonical Core; Staff frozen; Automation Studio remains JARVIS.

## QA / real-world certification gates — no false pass
1. **Local source QA**: new UI and JSON tests, existing B6 registration/OTP/multipart, full TypeScript, historic migrations, source CI and disposable PostgreSQL 17 vendor suite; preserve exact SHA and all regressions.
2. **Auth provider OFF**: WhatsApp signed Auth hook, independent Meta template/provider attestation, actual verified delivery and OTP retry/replay test on Owner-authorized protected Staging. A 202 initiated response is NOT delivery evidence.
3. **Private document security OFF**: real `qf-vendor-verification-private` bucket ACL/retention, certified ClamAV binary and signatures with benign EICAR detection, scan receipts/quarantine, AAL2 review and purge. Latest JARVIS loopback probe was `unavailable`, not a scanner certification.
4. **Real owner/UX OFF**: deployed exact VOX/Core image digest+signature and rollback, Cloudflare Access → Owner login → TOTP AAL2 → queue/case revision-locked decision. Prove an actual user cannot access another vendor's file or activate matching through Pending.
5. **Location and rollout OFF**: Google Places API key/billing renewal, canonical Pune/PCMC city geofence and autocomplete; all real external gates require separate approval, clean baseline/restore and protected Staging before any public launch.

**Source-level success is not Phase 2 operational completion.** A green Phase 2 draft may advance to gated Staging only after Phases 3/4 external evidence, signed recovery and Owner authorization. No field should be turned on merely for passing tests.

Master Notion: https://app.notion.com/p/40f751ba167c819d8827cb89a5340dcc
