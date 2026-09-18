begin;

create table if not exists public.jarvis_service_availability_taxonomy (
  singleton boolean primary key default true check (singleton),
  taxonomy_version bigint not null default 1 check (taxonomy_version between 1 and 1000000),
  updated_at timestamptz not null default now()
);

insert into public.jarvis_service_availability_taxonomy (singleton, taxonomy_version)
values (true, 1)
on conflict (singleton) do nothing;

create table if not exists public.jarvis_service_availability_pairs (
  city_id uuid not null references public.cities(id) on delete cascade,
  service_category_id uuid not null references public.service_categories(id) on delete cascade,
  is_active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (city_id, service_category_id)
);

create index if not exists idx_jarvis_service_availability_pairs_active
  on public.jarvis_service_availability_pairs (service_category_id, city_id)
  where is_active = true;
create or replace function public.bump_jarvis_service_availability_taxonomy()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.jarvis_service_availability_taxonomy
     set taxonomy_version = taxonomy_version + 1,
         updated_at = current_timestamp
   where singleton = true
     and taxonomy_version < 1000000;
  if not found then
    raise exception using errcode = '22003', message = 'jarvis service availability taxonomy version exhausted';
  end if;
  return null;
end;
$$;

revoke all on function public.bump_jarvis_service_availability_taxonomy() from public, anon, authenticated;

drop trigger if exists trg_jarvis_availability_cities on public.cities;
create trigger trg_jarvis_availability_cities
after insert or update or delete on public.cities
for each statement execute function public.bump_jarvis_service_availability_taxonomy();
drop trigger if exists trg_jarvis_availability_services on public.service_categories;
create trigger trg_jarvis_availability_services
after insert or update or delete on public.service_categories
for each statement execute function public.bump_jarvis_service_availability_taxonomy();

drop trigger if exists trg_jarvis_availability_pairs on public.jarvis_service_availability_pairs;
create trigger trg_jarvis_availability_pairs
after insert or update or delete on public.jarvis_service_availability_pairs
for each statement execute function public.bump_jarvis_service_availability_taxonomy();

alter table public.jarvis_service_availability_taxonomy enable row level security;
alter table public.jarvis_service_availability_pairs enable row level security;
revoke all on public.jarvis_service_availability_taxonomy from anon, authenticated;
revoke all on public.jarvis_service_availability_pairs from anon, authenticated;
grant select on public.jarvis_service_availability_taxonomy to service_role;
grant select on public.jarvis_service_availability_pairs to service_role;

comment on table public.jarvis_service_availability_pairs is
  'Core-owned explicit city-service availability pairs for the signed Jarvis read boundary. No inferred cross-product.';
comment on function public.bump_jarvis_service_availability_taxonomy() is
  'Advances the bounded Jarvis availability generation after a Core catalogue or explicit-pair mutation.';

commit;
