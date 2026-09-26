-- QF category runtime governance
-- Admin taxonomy remains the source of truth; automation is explicit and fail-closed.
alter table public.service_categories
  add column if not exists automation_key text,
  add column if not exists lead_service_value text,
  add column if not exists matching_aliases text[] not null default '{}'::text[],
  add column if not exists automation_enabled boolean not null default false,
  add column if not exists automation_configured_at timestamptz,
  add column if not exists automation_configured_by text;

create unique index if not exists service_categories_automation_key_uidx
  on public.service_categories (lower(automation_key))
  where automation_key is not null;

update public.service_categories
set
  automation_key = case slug
    when 'interior' then 'interior'
    when 'interior-designers' then 'interior-designers'
    when 'carpenters' then 'carpenters'
    when 'modular-factory' then 'modular-factory'
    when 'premium-interiors' then 'premium-interiors'
    when 'sofa' then 'sofa'
    when 'painter' then 'painter'
    when 'civil-work' then 'civil-work'
    else automation_key
  end,
  lead_service_value = case slug
    when 'interior-designers' then 'Full Home Interior'
    when 'carpenters' then 'Carpentry'
    when 'modular-factory' then 'Modular Kitchen'
    when 'premium-interiors' then 'Premium Interior Design'
    when 'sofa' then 'Custom Sofa & Upholstery'
    when 'painter' then 'Painting'
    when 'civil-work' then 'Home Renovation'
    else coalesce(lead_service_value, name)
  end,
  automation_enabled = case
    when slug in ('interior-designers','carpenters','modular-factory','premium-interiors','sofa','painter','civil-work') then true
    else automation_enabled
  end,
  automation_configured_at = case
    when slug in ('interior-designers','carpenters','modular-factory','premium-interiors','sofa','painter','civil-work')
      then coalesce(automation_configured_at, now())
    else automation_configured_at
  end,
  automation_configured_by = case
    when slug in ('interior-designers','carpenters','modular-factory','premium-interiors','sofa','painter','civil-work')
      then coalesce(automation_configured_by, 'migration:qf-category-runtime-governance')
    else automation_configured_by
  end
where slug in ('interior','interior-designers','carpenters','modular-factory','premium-interiors','sofa','painter','civil-work');

update public.service_categories set matching_aliases = array[
  'Interior Designers','Full Home Interior','Home Interior','Interior Design','Interior Designer','Interior','Interiors','False Ceiling'
] where slug = 'interior-designers';
update public.service_categories set matching_aliases = array[
  'Carpenters','Carpentry','Carpenter','Custom Furniture','Furniture','Woodwork','Wood Work','Wardrobe'
] where slug = 'carpenters';
update public.service_categories set matching_aliases = array[
  'Modular Factory','Modular Kitchen','Modular','Kitchen','Factory Finish','Factory Made Furniture','Machine Finish Furniture','Modular Furniture','Wardrobe'
] where slug = 'modular-factory';
update public.service_categories set matching_aliases = array[
  'Premium Interiors','Premium Interior','Premium Interior Design','Luxury Interior'
] where slug = 'premium-interiors';
update public.service_categories set matching_aliases = array[
  'Sofa','Sofa Maker','Sofa Makers','Custom Sofa & Upholstery','Custom Sofa and Upholstery','Upholstery','Recliner','Sofa Repair'
] where slug = 'sofa';
update public.service_categories set matching_aliases = array[
  'Painter','Painting','Paint','Texture Painting','Wall Painting'
] where slug = 'painter';
update public.service_categories set matching_aliases = array[
  'Civil Work','Civil','Home Renovation','Renovation','Tiling','Tile Work','Masonry','POP','Waterproofing'
] where slug = 'civil-work';
update public.service_categories set matching_aliases = array['Interior','Interiors'] where slug = 'interior';

-- Every row gets a stable default configuration without making new categories auto-routable.
update public.service_categories
set automation_key = coalesce(nullif(automation_key, ''), slug),
    lead_service_value = coalesce(nullif(lead_service_value, ''), name),
    matching_aliases = case
      when coalesce(array_length(matching_aliases, 1), 0) = 0 then array[name]
      else matching_aliases
    end;

revoke update (automation_key, lead_service_value, matching_aliases, automation_enabled,
  automation_configured_at, automation_configured_by)
  on public.service_categories from anon, authenticated;
