-- QuickFurno vendor review system — forward-only production schema.
-- Reviews are server-written. Public clients never receive direct table write access.
begin;

create table if not exists public.vendor_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete restrict,
  assignment_id uuid not null references public.lead_assignments(id) on delete restrict,
  reviewer_display_name text not null check (char_length(reviewer_display_name) between 1 and 80),
  rating smallint not null check (rating between 1 and 5),
  review_text text not null check (char_length(review_text) between 20 and 1000),
  category text,
  city text,
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','hidden')),
  source text not null default 'verified_lead'
    check (source in ('verified_lead','admin_import')),
  verified_interaction boolean not null default true,
  moderated_at timestamptz,
  moderated_by uuid references public.profiles(id) on delete set null,
  moderation_note text check (moderation_note is null or char_length(moderation_note) <= 500),
  feature_on_homepage boolean not null default false,
  constraint vendor_reviews_one_per_vendor_lead unique (vendor_id, lead_id),
  constraint vendor_reviews_verified_source check (
    source <> 'verified_lead' or verified_interaction = true
  )
);

create index if not exists idx_vendor_reviews_public
  on public.vendor_reviews(vendor_id, status, created_at desc);
create index if not exists idx_vendor_reviews_moderation
  on public.vendor_reviews(status, created_at desc);

alter table public.vendor_reviews enable row level security;

revoke all on table public.vendor_reviews from public, anon, authenticated;
grant select, insert, update on table public.vendor_reviews to service_role;

comment on table public.vendor_reviews is
  'Verified QuickFurno vendor reviews. Public submissions are accepted only after server-side proof of a real lead assignment. Pending/rejected/hidden rows never affect public ratings. Phone numbers are never stored here.';

comment on column public.vendor_reviews.lead_id is
  'Private evidence link proving the reviewer had a QuickFurno lead connected to this vendor.';
comment on column public.vendor_reviews.assignment_id is
  'Private assignment evidence used by the submission authority. Never exposed publicly.';
comment on column public.vendor_reviews.reviewer_display_name is
  'Sanitized public display name derived from the matched lead name; never a phone or raw identity token.';

commit;
