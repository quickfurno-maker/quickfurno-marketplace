# VOX-10A — Current Staff EOD source coordinator
16 October 2026. **SOURCE/ISOLATED only.** Stacked on VOX-08O PR #312.

Reuses `allSourceEodEvidence.mjs` and actual existing Core `/api/vox/v1/eod-preview` (which is **CORE_WORK_LEDGER_ONLY** and partial). Adds `contracts/vox/fourSourceEodCoordinator.mjs` to concurrently request four **Core server-owned** source readers with current Staff/team/city/businessDate, bound each at 100 rows, reject forged/PII/mis-scoped responses and explicitly report unavailable readers. Even four asserted watermarks NEVER authorize final EOD or publish an audited rollup: response has `rollup:null`, `canSubmit:false` and no provider messages. Individual Core source streams and actual signed non-Core readers are NOT yet wired; the injected readers in tests are synthetic.
New seven isolated negative tests and full Core regression are in `scripts/mvp/vox`. Production and protected staging remain unmodified, all flags OFF.
**Next:** independently verify real Aarohi/Service Desk/Conversation readers, assign exact client subject scopes and sign source watermarks; human-reviewed all-source EOD submission and real AAL2 remain blocked.
