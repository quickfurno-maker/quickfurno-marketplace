-- ============================================================================
-- QuickFurno — False Ceiling becomes its own marketplace category.
--
-- WHAT THIS DOES
--   1. public.service_categories: re-activates the existing 'false-ceiling' row
--      (soft-deactivated in Phase 14C) as a top-level category "False Ceiling"
--      (sort_order 50, after Civil Work). Inserts it if it is missing.
--   2. Matching helpers, mirroring lib/vendors/categoryMatching.ts exactly:
--        - public.qf_category_groups_for_label (synonym groups)
--        - public.qf_parent_category_group     (parent groups, max 3 per group)
--      Both gain a 'False Ceiling' group. 'false ceiling' leaves the Interior
--      groups and 'pop' leaves the Civil Work groups, so a False Ceiling
--      enquiry reaches vendors who list False Ceiling / POP / gypsum ceiling,
--      and interior or civil vendors no longer receive ceiling-only enquiries.
--
-- SAFETY
--   - Additive: one upsert + CREATE OR REPLACE of two pure helper functions.
--     No table dropped, no row deleted, no existing assignment or credit touched.
--   - Signatures, return types, language and volatility are unchanged.
--   - CREATE OR REPLACE resets function settings, so the search_path pin added
--     by 20260911000000_qf_launch_security_closeout is restated on
--     qf_parent_category_group. qf_category_groups_for_label never had one.
--   - Idempotent: safe to run more than once.
--   - Self-verifies at the end and rolls back on any mismatch.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Category row.
-- ----------------------------------------------------------------------------
insert into public.service_categories (name, slug, is_active, parent_id, sort_order, updated_by, updated_at)
values ('False Ceiling', 'false-ceiling', true, null, 50, 'system_seed', now())
on conflict (slug) do update
  set name = excluded.name,
      is_active = true,
      parent_id = null,
      sort_order = excluded.sort_order,
      updated_by = excluded.updated_by,
      updated_at = now();

-- ----------------------------------------------------------------------------
-- 2a. Synonym groups (was 20260702000034_fix_auto_match_category_mapping).
-- ----------------------------------------------------------------------------
create or replace function public.qf_category_groups_for_label(p_value text)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(group_name order by group_name), '{}'::text[])
  from (
    values
      ('Interior Designers', array[
        'interior designers', 'interior designer', 'full home interior',
        'home interior', 'interior design', 'interior', 'interiors'
      ]::text[]),
      ('Carpenters', array[
        'carpenters', 'carpenter', 'carpentry', 'custom furniture',
        'furniture', 'woodwork', 'wood work', 'wardrobe'
      ]::text[]),
      ('Modular Factory', array[
        'modular factory', 'modular kitchen', 'kitchen', 'factory finish',
        'factory made furniture', 'machine finish furniture',
        'modular furniture', 'wardrobe'
      ]::text[]),
      ('Premium Interiors', array[
        'premium interiors', 'premium interior', 'premium interior design',
        'luxury interior'
      ]::text[]),
      ('Sofa', array[
        'sofa', 'sofa maker', 'sofa makers', 'custom sofa and upholstery',
        'upholstery', 'recliner', 'sofa repair'
      ]::text[]),
      ('Painter', array[
        'painter', 'painting', 'paint', 'texture painting', 'wall painting'
      ]::text[]),
      ('Civil Work', array[
        'civil work', 'civil', 'home renovation', 'renovation', 'tiling',
        'tile work', 'masonry', 'plumbing civil', 'waterproofing'
      ]::text[]),
      ('False Ceiling', array[
        'false ceiling', 'pop', 'pop ceiling', 'pop false ceiling',
        'gypsum ceiling', 'gypsum false ceiling', 'ceiling', 'ceiling work',
        'cove lighting'
      ]::text[])
  ) as groups(group_name, labels)
  where public.qf_normalize_category_label(p_value) = any (
    select public.qf_normalize_category_label(label_value) from unnest(labels) as label(label_value)
  );
$$;

-- ----------------------------------------------------------------------------
-- 2b. Parent groups (was 20260705000130_distance_category_matching_rpc).
-- ----------------------------------------------------------------------------
create or replace function public.qf_parent_category_group(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(
    (
      select group_name
      from (
        values
          ('Interior', array[
            'full home interior','home interior','interiors','interior','interior design',
            'interior designers','interior designer','premium interiors','premium interior',
            'premium interior design','luxury interior','carpenters','carpenter','carpentry',
            'custom furniture','furniture','woodwork','wood work','furniture work','modular factory',
            'modular kitchen','kitchen','modular furniture','factory made furniture',
            'machine finish furniture','wardrobe','turnkey interior',
            'complete interior','kitchen carpenter'
          ]::text[]),
          ('Sofa', array[
            'sofa','sofa maker','sofa makers','upholstery','sofa repair','sofa cleaning',
            'recliner','custom sofa and upholstery'
          ]::text[]),
          ('Painting', array[
            'painter','painting','paint','wall painting','texture painting'
          ]::text[]),
          ('Civil Work', array[
            'civil work','civil','renovation','home renovation','masonry','tiling','tile work',
            'plumbing civil','plumbing','waterproofing'
          ]::text[]),
          ('False Ceiling', array[
            'false ceiling','pop','pop ceiling','pop false ceiling','gypsum ceiling',
            'gypsum false ceiling','ceiling','ceiling work','cove lighting'
          ]::text[])
      ) as groups(group_name, labels)
      where public.qf_normalize_category_label(p_value) = any (
        select public.qf_normalize_category_label(l) from unnest(labels) as label(l)
      )
      limit 1
    ),
    -- Unmapped category keeps its own stable group (the normalized label).
    public.qf_normalize_category_label(p_value)
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. Self-verification — fail closed on any deviation.
-- ----------------------------------------------------------------------------
do $verify$
begin
  if not exists (
    select 1 from public.service_categories
    where slug = 'false-ceiling' and name = 'False Ceiling' and is_active and parent_id is null
  ) then
    raise exception 'False Ceiling migration aborted: category row is not active.';
  end if;

  if public.qf_parent_category_group('False Ceiling') is distinct from 'False Ceiling'
     or public.qf_parent_category_group('POP') is distinct from 'False Ceiling'
     or public.qf_parent_category_group('Home Renovation') is distinct from 'Civil Work'
     or public.qf_parent_category_group('Full Home Interior') is distinct from 'Interior'
     or public.qf_parent_category_group('Painting') is distinct from 'Painting'
  then
    raise exception 'False Ceiling migration aborted: parent groups do not match the app.';
  end if;

  if public.qf_category_groups_for_label('False Ceiling') is distinct from array['False Ceiling']::text[]
     or public.qf_category_groups_for_label('pop') is distinct from array['False Ceiling']::text[]
     or public.qf_category_groups_for_label('Home Renovation') is distinct from array['Civil Work']::text[]
  then
    raise exception 'False Ceiling migration aborted: synonym groups do not match the app.';
  end if;

  -- A ceiling enquiry reaches ceiling vendors, not interior-only vendors.
  if not public.qf_lead_vendor_parent_group_compatible('False Ceiling', 'False Ceiling', null, array['POP'], null, null)
     or public.qf_lead_vendor_parent_group_compatible('False Ceiling', 'False Ceiling', null, array['Interior Designers'], null, null)
     or not public.qf_lead_vendor_parent_group_compatible('Home Renovation', 'Civil Work', null, array['Civil Work', 'POP'], null, null)
  then
    raise exception 'False Ceiling migration aborted: lead/vendor compatibility is wrong.';
  end if;

  if (select array_to_string(coalesce(p.proconfig, array[]::text[]), ',')
        from pg_proc p where p.oid = to_regprocedure('public.qf_parent_category_group(text)'))
       not like '%search_path=pg_catalog, public, pg_temp%' then
    raise exception 'False Ceiling migration aborted: qf_parent_category_group lost its pinned search_path.';
  end if;
end
$verify$;

commit;
