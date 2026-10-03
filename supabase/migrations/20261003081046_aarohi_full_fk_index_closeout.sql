-- Aarohi full foreign-key index closeout.
-- Performance-only additive hardening. No runtime/provider behavior changes.

create index if not exists aarohi_campaign_members_added_by_idx
  on public.aarohi_campaign_members(added_by);

create index if not exists aarohi_campaign_members_prospect_id_idx
  on public.aarohi_campaign_members(prospect_id);

create index if not exists aarohi_campaigns_created_by_idx
  on public.aarohi_campaigns(created_by);

create index if not exists aarohi_handoffs_completed_by_idx
  on public.aarohi_handoffs(completed_by);

create index if not exists aarohi_identity_matches_prospect_b_id_idx
  on public.aarohi_identity_matches(prospect_b_id);

create index if not exists aarohi_identity_matches_reviewed_by_idx
  on public.aarohi_identity_matches(reviewed_by);

create index if not exists aarohi_interactions_conversation_id_idx
  on public.aarohi_interactions(conversation_id);

create index if not exists aarohi_opportunities_core_order_reference_idx
  on public.aarohi_opportunities(core_order_reference);

create index if not exists aarohi_opportunities_core_vendor_id_idx
  on public.aarohi_opportunities(core_vendor_id);

create index if not exists aarohi_opportunities_interested_package_id_idx
  on public.aarohi_opportunities(interested_package_id);

create index if not exists aarohi_opportunities_prospect_id_idx
  on public.aarohi_opportunities(prospect_id);

create index if not exists aarohi_prospects_human_owner_idx
  on public.aarohi_prospects(human_owner);

create index if not exists aarohi_prospects_merged_into_prospect_id_idx
  on public.aarohi_prospects(merged_into_prospect_id);

create index if not exists aarohi_tasks_assigned_to_idx
  on public.aarohi_tasks(assigned_to);

create index if not exists aarohi_tasks_created_by_idx
  on public.aarohi_tasks(created_by);

create index if not exists aarohi_tasks_prospect_id_idx
  on public.aarohi_tasks(prospect_id);

create index if not exists communication_conversations_aarohi_prospect_id_idx
  on public.communication_conversations(aarohi_prospect_id);
