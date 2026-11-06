# QuickFurno F11 — signed callbacks, Staging perimeter and separate WhatsApp sender provenance

**NO DEPLOY · NO LIVE SEND · NO AUTOMATIC EXTERNAL CHANGE**

## Locked identities

| Purpose | Agent | WhatsApp number | WABA | Phone ID | Auth template |
| --- | --- | --- | --- | --- | --- |
| Client | Riya | +91 77091 72106 | `27861262223494153` | `1333595106493545` | approved `qf_client_auth_otp` / ID `1793889608370870` |
| Vendor | Anisha | +91 93596 68469 | `1569174604351612` | `1088396637681784` | approved `qf_vendor_auth_otp` / ID `1640977640737783` |

Aarohi remains a distinct prospective acquisition agent/number; this work does not give her permission to send OTPs or borrow either sender.

## Actual managed Staging evidence, 6 November 2026

Supabase Staging `uckafzuochmbvtiodmcl` ACTIVE_HEALTHY. Latest READ-ONLY DB select returned: `riya_disabled=1`, `anisha_disabled=1`, `meta_policy_disabled=1`, `active_otp_mappings=0`, `enabled_otp_automations=0`, `recorded_auth_otp_messages=0`. Both WABA identities match their pinned sender IDs. **No Staging migration, Meta send, Supabase Auth config or Production change occurred under F11.**

Latest read-only Meta Graph GET for Anisha `1569174604351612` and phone `1088396637681784` returned **CONNECTED, quality RED**. This does not clear launch readiness.

**Perimeter observation, not callback certification:** JARVIS TLS-verified external HEAD and NO-TOKEN GET probes to these three paths on **`https://vox.quickfurno.in`**:
- `/api/webhooks/whatsapp/meta` → 302 Cloudflare Access redirect;
- `/api/auth/hooks/supabase-send-sms` → 302 Cloudflare Access redirect;
- `/api/vox/v1/owner-whatsapp-launch-readiness` → 302 Cloudflare Access redirect.

Reproducible standalone `scripts/mvp/launch/probe-f11-callbacks-no-send.mjs` runs **dry-run without network by default**. Explicit `--execute` performs only GET (no POST, OTP, signature, credentials or writes), follows no redirects, and reports status and sanitized Access classification, never cookies or Location values. It independently reproduced 302/Access for all three paths. **This does not confirm the actual configured Meta Callback URL or Supabase Send SMS HTTP Hook URI**; they may point to a different Core host. We have NOT accessed or changed the deployed secret store or Supabase Auth configuration.

**Critical compatibility condition:** If either external provider is actually configured to call the VOX-host protected endpoint, the interactive Access redirect will obstruct its automated callback. Do not open the entire VOX host to public traffic. Cloudflare documents a narrowly scoped Bypass application policy for public OAuth/webhook endpoints but warns that it disables Access enforcement and Access request logging for matched traffic (see [Cloudflare public endpoint policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/)). Prefer a dedicated controlled callback host if topology supports it; otherwise restrict public access to the **two callback paths only**, with signed app-level authenticity, WAF/logging/rate limits and origin controls. No bypass policy has been created here.

## Actual local cryptographic certification, without live callbacks

- The **official Standard Webhooks library** signs and verifies a synthetic Supabase Send SMS event. Wrong/missing headers, changed OTP/user bytes, wrong secret, wrong webhook ID/timestamp, invalid shape, and wrong key all fail. Controlled two-key rotation succeeds.
- Meta Cloud raw-byte HMAC-SHA256 authenticates synthetic inbound callback envelopes. Wrong secret, malformed signature, altered vendor phone ID, cross-WABA signed spoofing and mixed client/vendor webhook envelopes reject. Correct synthetic Riya and Anisha envelopes pass only their exact paired registry identity.
- The existing Meta GET challenge code validates a matching private token in a synthetic local test; actual Meta subscription GET challenge has NOT been tested with the real provider token.
- Static source checks confirm both existing thin routes call bounded raw body readers and that signatures precede payload parse, identity and side effects. No runtime code was touched in F11.
- Pure callback perimeter policy allows **two callback paths**: Meta GET challenge/POST signed events; Supabase POST signed Send SMS Auth Hook. It excludes VOX Owner, Staff, Finance and vendor signup routes from any public exception. Even a full set of mock green signals always yields RELEASE HOLD, never permission to send or deploy.
- JARVIS F11 targeted suites: **28 signed crypto + 28 route/security cases, 56/56 PASS**. Prior F10 recert/162 vendor integration/46 JARVIS checks, complete TypeScript/Next build and loopback route HOLD are independently rerun in CI.

## EXACT remaining operator verification, external HOLD

1. Read configured **Supabase Staging Authentication → Hooks → Send SMS** URI, enabled state and signing mode, and **Meta App → WhatsApp → Configuration** Callback URL/subscribed WABA(s), recording URI host and path **ONLY**. Do **not** paste or print any hook signing secret, token, phone OTP or customer record.
2. If provider callback URI uses `vox.quickfurno.in` and returns Access 302, configure a reviewed, narrowly scoped ingress design for the exact callback route(s), NOT an all-host Access bypass; ensure valid Meta challenge can reach GET handler, invalid Meta HMAC never reaches provider-account effects, and invalid Supabase Standard Webhooks signature never reaches OTP dispatch. Retain VOX Owner application behind Access and MFA. Do not enable public ingress without Owner/release review and WAF/observability signoff.
3. Prove **two independent runtime credential sets** (Riya and Anisha) on the actual deployed Staging service without displaying secrets. Verify WABA/Phone Number IDs, outbound provider-account attribution, Meta webhook subscriptions and signed receipt-to-message linkage on each account.
4. Once Meta vendor quality is independently GREEN and permissions/limits/consent approved, perform **one controlled opted-in handset** `vendor_login` OTP: verify provider receipt bound to Anisha UUID, Supabase `verifyOtp`, Pending-only vendor registration, returning login and VOX Owner review. Never use Riya's number as fallback. Any ambiguous send outcome parks; never retry blindly.
5. Keep ClamAV OFF per Owner; scan-dependent vendor verification, assignment and credits remain closed until independent safe scan proof. Merge, Production and automatic sending remain HOLD until explicit reviewed GO.

Supabase's official HTTP Auth Hook guidance requires signed Standard Webhooks payload verification, and its Send SMS hook is synchronous with an HTTP success/timeout contract ([Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks), [Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)). F11 does not modify the original hardened Hook behavior.

**No production deployment occurred.** F11 is a REVIEW / NO DEPLOY preflight; not a deployment, not signed live E2E, and not a grant to waive F1/F5/F6 integration review.
