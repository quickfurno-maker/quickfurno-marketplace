# AB-7F — Bounded real Core internal worker / AGNI health adapter (RELEASE HOLD)

`runAb7fCoreInternalWorker` now invokes the already existing Core-only approved notification supervisor and underlying atomic claim/process/fail RPC adapters, with one bounded iteration (at most 5 jobs). It validates current Owner AAL2, release attestation and strict staging enablement and sends **sanitized advisory-only** counts to AGNI. Telemetry errors cannot undo committed Core work.

No timer, scheduler, VPS service bootstrap, push verification, provider messages or automatic AGNI remediation was introduced. Actual protected Staging SQL installation, independent DBA/AppSec/TL/release attestation, service registration, DLQ operator UI and watchdog monitoring remain P0. Offline tests use synthetic signed releases, not actual reviewer approvals.
