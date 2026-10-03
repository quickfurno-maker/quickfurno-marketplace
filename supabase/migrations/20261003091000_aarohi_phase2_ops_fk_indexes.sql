-- Aarohi Phase 2 FK index hardening from staging advisor review.
create index if not exists aarohi_acquisition_cost_entries_created_by_idx
  on public.aarohi_acquisition_cost_entries(created_by) where created_by is not null;
create index if not exists aarohi_runtime_controls_updated_by_idx
  on public.aarohi_runtime_controls(updated_by) where updated_by is not null;
create index if not exists aarohi_channel_identities_source_id_idx
  on public.aarohi_channel_identities(source_id) where source_id is not null;
