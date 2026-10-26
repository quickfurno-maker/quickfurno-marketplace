# VOX AB-7 Final Operational Closure — four-track source integration (RELEASE HOLD)

Base: [Core draft #356](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/356), exact baseline `0e20c628fb31e61339bdeb8d37bd590857cace0f`.

This AB-8 integrator combines **separate draft, unmerged branches** with unchanged deployment gates:

- **AB-7C/B** [#357](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/357) canonical current consent + Core Conversation signed-PAUSE preparation. It **cannot** execute any conversation write, takeover, resume or provider message; protected atomic canonical consent/original event/nonce remains P0.
- **AB-7A** [#358](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/358) signed independent-review staged Core Staff DB access-fencing contract. It **does not** invalidate GoTrue/Auth sessions or perform live suspension; protected Core DB RPC, staff account state and session reconciliation remain P0.
- **AB-7D** [#359](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/359) verified four-distinct-sources + independent Team Leader EOD publication **proposal**, always official:false, published:false until actual reviewed Core finalizer; protected signers/official ledger remain P0.
- **AB-7E** [#360](https://github.com/quickfurno-maker/quickfurno-marketplace/pull/360) internal-only manual recovery triage for stale leases/dead letters/unknown outcome; no job claim, dispatcher activation, retries, provider send, autonomous AGNI action; reviewed worker deployment remains P0.

Four sets of focused Node security cases (4+4+3+3) are explicitly included in continuous integrated AB-8 CI. Existing six offline PG17 provenance suites plus genuine Support and Aarohi writer PG17 (eight total) stay mandatory. All existing Core/Web source protections remain.

**Not a production/staging certification.** Nothing in these source modules itself connects to managed Supabase, Staff identity, real providers or VPS. Independent DBA/AppSec + reviewer bootstrap/AAL2 + exact reconciled migrations + signed staging browser E2E + Owner GO are still required. Do not merge/promote or enable feature flags. Cursor reviewer deferred, not waived.

The exact integrated commit and GitHub CI outcome must be recorded separately once verified, and cannot be inferred from four focused tests.
