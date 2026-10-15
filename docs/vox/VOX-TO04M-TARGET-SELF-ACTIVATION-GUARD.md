# VOX TO-04M — reviewer/target separation revalidated at activation
Source-only candidate-B SQL fix, **not selected, merged or deployed**.

Current comparison of two unmerged reviewed-department stacks found candidate A explicitly checks `reviewer != target` in its activation function. Candidate B checked at *review* but only checked `reviewer != owner` and `target != owner` again during *activation*. A changed or corrupted request row could consequently turn a valid Team Leader reviewer into the beneficiary of their own approval. Even if request manipulation requires a highly privileged path, each authoritative transaction must reject self-approval independently.

The new B candidate activation function now checks `r.decided_by = r.target_staff_id` and refuses with `VOX_DEPT_ACTIVATION_STALE`. The disposable PostgreSQL 17 test changes the approved request's target to the live, eligible, neutral synthetic TL reviewer, attempts activation, asserts the **exact** SQL rejection and confirms no grant or activation row was inserted, then restores the request and completes the positive, multi-department and revoke/replay cases.

The test uses an explicit rejection flag and `GET STACKED DIAGNOSTICS`. It does *not* put its own sentinel exception in a block that catches every `P0001`—that could falsely pass a broken guard.

No real Supabase Auth changes, first TL human signoff, migration, feature flag or production permission activation was performed. Independent security/DBA review of full candidate A/B SQL, 86-migration history, actual staging AAL2/IDOR and signed rollback remain P0.
