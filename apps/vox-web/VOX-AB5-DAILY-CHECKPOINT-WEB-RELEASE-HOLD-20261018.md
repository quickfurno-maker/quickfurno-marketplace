# VOX AB-5 Staff Daily Report source checkpoint UI — REVIEW HOLD

Adds server-only `lib/ab5SourceCheckpoint.ts`, independent feature flag `VOX_AB5_SOURCE_CHECKPOINT_UI_ENABLED=staging`, existing verified Staff MFA session, pinned canonical HTTPS Core `/api/vox/v1/ab5-source-checkpoints` and strict four-row bounded source proof parser. Fail closed on unknown keys, extra contact fields, fake official flags, spurious count/next-page action or an unmatched source.

Actual `/team/daily-report` now shows a separate previous-day four-source SQL checkpoint section (or explicit locked state) alongside existing current-day Core Work partial preview. Missing sources are **NOT** shown as zero productivity. UI states `not cryptographically certified`, `cannot submit/approve`, and never exposes contacts, transcript or vendor/client details.

Web adapter security tests 18/18, existing Web full suite and production build PASS in isolated local worktree; protected genuine Staff AAL2 staging browser test and human visual acceptance remain pending. No direct Core credentials/Service Role in client. Cursor review deferred.
