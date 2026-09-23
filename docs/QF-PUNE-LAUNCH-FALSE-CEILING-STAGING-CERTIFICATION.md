# QF Pune Launch — False Ceiling staging certification

**Date:** 23 September 2026
**Migration:** `20260922120000_false_ceiling_category.sql`
**SHA-256:** `775794173a6f463e03a38af9f822dd61756765be3860370837d63026c268e540`
**Result:** `QF_PUNE_LAUNCH_FALSE_CEILING_STAGING_MIGRATION_APPLIED_AND_VERIFIED`

## Execution evidence

The migration was applied to **QuickFurno Staging** from a fresh isolated Supabase CLI workspace whose local migration ledger was constructed from the live staging history. The pre-apply linked history showed 47 remote versions and exactly one local-only version: `20260922120000`.

A final `supabase db push --linked --dry-run` proposed exactly one migration:

- `20260922120000_false_ceiling_category.sql`

The real `supabase db push --linked --yes` then applied that exact migration once and completed successfully.

Independent post-apply history verification showed:

- staging migration-history rows: **48**
- `20260922120000` rows in staging history: **1**
- `20260922120000` rows in production history: **0**

## Live staging verification

Post-apply SQL verified all of the following:

- exactly one `false-ceiling` category row exists and is active as **False Ceiling**
- `qf_parent_category_group('False Ceiling') = 'False Ceiling'`
- `qf_parent_category_group('POP') = 'False Ceiling'`
- `qf_parent_category_group('Home Renovation') = 'Civil Work'`
- `qf_parent_category_group('Full Home Interior') = 'Interior'`
- `qf_parent_category_group('Painting') = 'Painting'`
- `qf_category_groups_for_label('False Ceiling') = {'False Ceiling'}`
- `qf_category_groups_for_label('POP') = {'False Ceiling'}`
- `qf_category_groups_for_label('Home Renovation') = {'Civil Work'}`
- a False Ceiling lead is compatible with a vendor listing POP
- a False Ceiling lead is **not** compatible with an Interior Designers-only vendor
- Home Renovation remains compatible with Civil Work
- `qf_category_groups_for_label(text)` is not executable by `anon` or `authenticated`
- `service_role` retains EXECUTE on that helper
- both category helper functions retain `search_path=pg_catalog, public, pg_temp`
- the new synonym helper remains `SECURITY INVOKER` / immutable

Supabase security and performance advisors were also re-run after the DDL change. They reported existing project-wide advisory inventory; the False Ceiling migration introduced no new table, RLS policy, public browser function grant, or performance index.

## Production status

Production was read-only checked after staging certification. Version `20260922120000` remains absent from production migration history. Production application still requires its own isolated exact-one deployment gate after PR merge.
