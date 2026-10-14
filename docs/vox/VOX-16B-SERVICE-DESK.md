# VOX-16B Service Desk native case state correction

The authoritative live QuickFurno Staging table `public.vendor_support_threads` has a status CHECK constraint permitting `open`, `vendor_replied`, `admin_replied` and `closed`. The earlier VOX projection incorrectly recognized `pending` and `resolved` but represented the two reply states as `UNKNOWN`, losing important queue context.

This source-only correction uses precisely those existing Core states, without creating any duplicate case table or adding case mutation endpoints. Assigned scoped staff may view vendor/admin reply statuses correctly; `canClose=false`, `slaStatus=NOT_CONFIGURED`, provider sending disabled and SUPPORT_REPLY remains a separate approval proposal pending native Core executor certification. No native support thread mutated.

This does **not** add SLA rules, escalations, provider messages, or human takeover executor: their authoritative policy, consent, revision, two-person atomic approval and delivery lifecycle remain release blockers. Exact-head UI/backend regression required before merge.
