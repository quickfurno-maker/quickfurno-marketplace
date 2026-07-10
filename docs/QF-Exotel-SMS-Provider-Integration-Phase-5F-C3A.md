# QuickFurno — Exotel SMS Provider Integration (Phase 5F-C3-A)

> **SMS is not live, and Exotel is not activated.** Phase 5F-C3-A adds the first real SMS
> provider adapter and leaves it permanently inactive. **No Exotel account exists** yet.
> There is no credential anywhere in this repository, no send path is reachable in any
> environment, and **no migration was created**.
>
> India DLT registration remains **external and pending**, and is the subject of **Phase
> 5F-C3-C**. No DLT approval is claimed, for the entity id, the sender header, or any
> content template.

---

## 0. What this phase does NOT do

Stated first, because everything below is easier to misread as activation than it is to
misread as inertness.

| Not done | Still true after this phase |
|---|---|
| No migration, no SQL, no DDL | The newest migration is still C1's `20260710000100_…` |
| No `.env` / `.env.local` / `.env.example` change | No Exotel variable is set anywhere |
| No real credential, in code, tests, or docs | The harness uses obviously-fake fixtures |
| No reachable SMS send path | Nothing in `app/`, `lib/`, `services/` constructs the adapter |
| No fallback wiring | Phase 5F-C1's decision engine and attempt ledger are untouched |
| No WhatsApp change | Meta adapter, `CommunicationService`, hook routing all untouched |
| No retry, no queue, no n8n | The adapter performs at most **one** HTTP request per call |
| No UI change, no unrelated cleanup | — |
| No provider activation | No Exotel runtime policy, account, template mapping, or canary row exists |

A complete Exotel configuration makes the provider a **candidate**. That is all it makes it.

## 1. Authority boundaries

Restated unchanged. Nothing in this phase moves them.

| Concern | Authority |
|---|---|
| `client_login_otp` OTP + session | **Supabase Auth** |
| `vendor_whatsapp_verify` challenge state | **`verification_challenges`** |
| `vendor_password_reset` challenge state | **`verification_challenges`** |
| Business communication authorization | **Phase 4 Policy Engine** |
| Communication message ledger + dispatch | **CommunicationService** |
| Authentication fallback decision | **Phase 5F-C1** decision engine + attempt ledger |
| Channel selection | Transport policy — *never* an authentication authority |
| Provider selection | Infrastructure policy — *never* an authentication authority |

**Provider readiness never authorizes anything.** This is the C2 rule, preserved verbatim.
Before a single SMS could leave this system, a dispatch would have to pass, in order:

1. the C2 provider **selection** (a reviewed mode + a complete server-only config);
2. the C2 SMS **runtime infrastructure gate** — an operational runtime policy with
   `outbound_enabled`, a `provider_ready` / `complete` / `healthy` provider account, an
   approved, active, `authentication`-category template mapping, and (under `canary`) an
   allowlisted destination hash;
3. Phase 5F-C1's **fallback decision**, an explicit **active failure rule**, the **attempt
   budget**, and an **atomic attempt claim**.

Not one Exotel row exists for step 2, and Phase 5F-C1 ships **zero** active failure rules.
The provider is therefore unreachable by construction, not merely by convention.

## 2. The closed provider vocabulary

C2 shipped a closed vocabulary of exactly one value and recorded that no vendor could join
it "without the C3 review". This phase **is** that review, and it admits exactly one literal:

```
SMS_PROVIDER_MODE = mock          // the deterministic test/dev adapter
SMS_PROVIDER_MODE = exotel_sms    // the reviewed real adapter (INACTIVE)
```

There is no alias and no normalization: `exotel`, `EXOTEL_SMS`, and `Exotel` are all
unrecognised and fail closed. No other commercial provider has been chosen or selected —
not MSG91, Twilio, Gupshup, Kaleyra, Plivo, Vonage, or AWS SNS — and none may be added
without a further review.

## 3. Production fail-closed selection

`services/smsProviderSelection.ts` remains **lazy** — resolved per request, never at import
time, so a missing environment variable can never break the build.

| Environment | `SMS_PROVIDER_MODE` | Exotel config | Result |
|---|---|---|---|
| any | `exotel_sms` | complete | **candidate** — Exotel (still not permission to send) |
| any | `exotel_sms` | incomplete | **fail closed** — `provider_config_incomplete` |
| non-production | absent | — | controlled **mock** |
| non-production | `mock` | — | controlled **mock** |
| non-production | anything else | — | **fail closed** — `unsupported_provider_mode` |
| **production** | absent | — | **fail closed** — `mode_required_in_production` |
| **production** | `mock` | — | **fail closed** — `mock_forbidden_in_production` |
| **production** | anything else | — | **fail closed** — `unsupported_provider_mode` |

The two production rules C2 defined are unchanged: an absent mode is closed, and an explicit
mock is closed because a mock must never carry a live OTP. An incomplete Exotel config never
silently degrades to mock, in any environment.

## 4. Configuration contract (server-only)

Every variable is read **lazily**, at runtime, from the server environment. None is a
`NEXT_PUBLIC_*` name, so Next.js cannot inline one into a client bundle.

| Variable | Required | Shape |
|---|---|---|
| `EXOTEL_ACCOUNT_SID` | **yes** | `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` |
| `EXOTEL_API_KEY` | **yes** | printable ASCII, no `:`, no whitespace, 8–256 |
| `EXOTEL_API_TOKEN` | **yes** | printable ASCII, no `:`, no whitespace, 8–256 |
| `EXOTEL_SENDER_ID` | **yes** | DLT sender header, `[A-Za-z0-9]{3,11}` |
| `EXOTEL_SUBDOMAIN` | no | hostname ending in `.exotel.com`; default `api.exotel.com` |
| `EXOTEL_DLT_ENTITY_ID` | no | numeric passthrough |
| `EXOTEL_DLT_TEMPLATE_ID` | no | numeric passthrough |
| `EXOTEL_AUTH_HTTP_TIMEOUT_MS` | no | integer 500–4000; default 3000 |
| `EXOTEL_HEALTH_HTTP_TIMEOUT_MS` | no | integer 1000–15000; default 5000 |

Rules:

* A **missing or blank required** variable → config incomplete → **not a candidate**.
* A **present but malformed** variable (required *or* optional) → config incomplete. An
  invalid value is never silently ignored and never falls back to a default.
* `EXOTEL_SUBDOMAIN` is **Mumbai-endpoint aware**: Indian accounts set `api.in.exotel.com`.
  A host that does not end in `.exotel.com` is rejected — an SSRF fence, because a hostile
  value would otherwise redirect the Basic credentials to an attacker-controlled server.
* If any `NEXT_PUBLIC_*EXOTEL*` variable exists at all, the config is refused: its presence
  proves a credential was exposed to the client bundle.
* The loader **never logs a value**, never throws raw environment contents, and reports only
  variable **names** on every failure path.

The DLT ids are opaque **passthrough**. The adapter forwards them; it never derives,
fabricates, or guesses one.

## 5. Provider identity fence

`services/runtimeSmsProviderService.ts` constructs an adapter only from a caller-injected
factory, and only after verifying that

```
adapter.providerKey === selectedCandidate.providerKey   &&   adapter.channel === "sms"
```

This is the same fence Phase 5F-B applies to the Meta adapter. `ExotelSmsProvider.providerKey`
is exactly `"exotel_sms"`. A mock offered where Exotel was selected — or Exotel offered where
mock was selected — is rejected, and nothing is dispatched.

## 6. Transport and timeout semantics

The adapter uses the repository's abortable `HttpTransport`. The `AbortController` cancels
the **actual** request when the timeout elapses. A `Promise.race` pseudo-timeout is
**forbidden**: it rejects the waiter while the request keeps running, which is a duplicate-OTP
hazard. The harness asserts on the source that no `Promise.race` and no direct `fetch` call
exists in the adapter.

`options.maxNetworkTimeoutMs` is a **ceiling** supplied by an enclosing request deadline (the
Supabase Auth Hook budget). It may only **shorten** the configured timeout, never extend it,
and the shortened value still drives the `AbortController`.

The adapter performs **exactly one** request per call. It contains no loop, no scheduler, no
queue, and no retry counter. Phase 5F-C1's ledger remains the only attempt authority: at most
two transport attempts per authentication action, ever.

## 7. Outcome-certainty classification

Certainty is always present, always conservative, and is derived from the one generic model
in `lib/communication/providers/providerOutcome.ts` — never re-invented in the adapter. It is
never inferred from `accepted`, from `retryable`, from the existence of an HTTP error, from a
timeout, or from a thrown exception.

| Transport fact | Certainty | `retryable` | Failure code |
|---|---|---|---|
| 2xx **with** a usable SMS `Sid` | `accepted` | never | — |
| 2xx **without** a usable `Sid` | `unknown_outcome` | never | `EXOTEL_NO_MESSAGE_SID` |
| 4xx explicit provider rejection | `definitive_failure` | never | `EXOTEL_ERROR_<code>` → `EXOTEL_STATUS_<n>` → `EXOTEL_HTTP_<n>` |
| 5xx | `unknown_outcome` | never | `EXOTEL_HTTP_<n>` |
| timeout / abort | `unknown_outcome` | never | `EXOTEL_TIMEOUT` |
| ambiguous network failure (`ECONNRESET`, `EPIPE`, unclassified, …) | `unknown_outcome` | never | `EXOTEL_NETWORK_ERROR` |
| **proven pre-connect** failure (`ENOTFOUND`, `ECONNREFUSED`, `EAI_AGAIN`, …) | `definitive_failure` | **yes** | `EXOTEL_<CODE>` |

A 5xx is `unknown_outcome` because the request may already have been processed. An
`unknown_outcome` is **never** retry authorization and **never** fallback authorization: the
provider may have delivered the OTP, and resending would duplicate it.

Only a proven pre-connect failure — where the request demonstrably never left this host —
is both `definitive_failure` and safely retryable at the transport level.

## 8. Privacy and credential handling

* The API key and token travel **only** in the Basic `Authorization` header. They never
  appear in a URL, a request body, a result, an error, a log, or a database field.
* The OTP, the rendered message body, and the plaintext destination are never logged,
  retained, or echoed.
* The raw provider response body is parsed transiently and **never persisted**. Exotel's
  free-text `RestException.Message` routinely embeds the destination and the message body,
  so it is discarded outright: only a numeric code or status, rendered as an allowlisted
  identifier, survives into `errorCode`.
* Neither `exotelConfig.ts` nor `exotelSmsProvider.ts` contains a single `console` call.

The harness proves these by mutation: leaking a config value, or persisting the raw response
body, turns the suite red.

## 9. Content is never fabricated

`ExotelSmsProvider.sendAuthenticationMessage(...)` — the bare `SmsProvider` interface method
— **refuses to send** and returns a preflight `definitive_failure`
(`EXOTEL_RESOLVED_TEMPLATE_REQUIRED`), exactly as the Meta adapter refuses a bare template
key. Only `sendResolvedAuthenticationSms(...)` reaches the network, and it requires an
approved, DLT-registered resolved descriptor supplied by the caller.

This matters because **DLT registration remains external and pending**. Until Phase 5F-C3-C
completes it, there is no approved content template for the adapter to send, and the code
refuses to invent one.

## 10. What comes next

| Phase | Scope |
|---|---|
| **5F-C3-B** | Exotel delivery webhook + status normalization (not started) |
| **5F-C3-C** | Exotel account provisioning + India DLT registration — **external, pending** |
| **5F-C4** | SMS runtime activation, canary, and the first real fallback wiring |

Nothing in this phase anticipates the outcome of any of them.

## 11. Tests

```
npm run test:phase5f:c3a     # this phase — functional + mutation
npm run test:phase5f:c2      # SMS runtime foundation (vocabulary re-anchored, not weakened)
npm run test:phase5f:c       # C1 auth transport decision + attempt ledger (untouched)
npm run test:phase5f:b       # Meta WhatsApp Cloud API (untouched)
npm run test:phase5f:a       # messaging channel/provider foundation (untouched)
```

The C3-A harness instantiates the Exotel adapter against an **injected fake transport**. No
network call is made, no real credential exists, and no SMS is sent.
