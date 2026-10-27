# VOX-08N — actual concurrent PostgreSQL session lease proof (16 October 2026)

The prior VM and one-transaction PostgreSQL tests did not establish independent database-session lock behavior. This source QA extension closes that **specific isolated gap** without real live Staff tokens.

- SQL fixture `ops/vox/tests/vox08n_two_session_claim_fixture.sql` inserts one synthetic work-event into a **verified staging-archive clone only**, causing one outbox intent via the real AFTER INSERT trigger.
- `ops/vox/offline/invoke-08n-two-session-claim.ps1` refuses to run unless container name starts with `qf-vox08n-replay-`, network mode is `none`, there are zero published ports, and target is `vox08n_disposable`. It starts a real independent PostgreSQL worker session that claims the job under a transaction and holds the row lock with `pg_sleep(7)`.
- A second real PostgreSQL session runs `qf_vox_staff_notification_outbox_claim_v1` while the first holds that row lock. The second returns **zero rows**; first returns exactly one committed claim. The outbox row is subsequently verified as `LEASED`, `attempts=1`, with lease owner exactly Worker #1.
- The committed, reproducible `invoke-08n-stage-clone-replay.ps1` now runs this two-session SQL lock check after all 8 candidate SQL files and three security proofs. Execution observed: **`TWO_INDEPENDENT_PG_SESSIONS_SKIP_LOCKED_PASS=1_OF_2_CLAIMS`**, plus **`WORKER1_LEASE_COMMITTED_WORKER2_SKIPPED_LOCKED_ROW`**. Saved on JARVIS under `D:\QuickFurno-Workspace\Artifacts\VOX-08N-20261016-Concurrent-Repro-Fixed.log`; local disposable container removed.

### Boundaries
This establishes a genuine two-session `SKIP LOCKED` race on a single synthetic Core work event, not a complete production workload soak or multi-instance service crash certification. No real Staff MFA, independent Team Leader, city/department revocation during an active drain, workload of 100+ eligible Staff, external message channel, lease metrics dashboard, retention approval, protected staging promotion or provider send was tested. Source remains outside managed migrations and absolutely release-held.
