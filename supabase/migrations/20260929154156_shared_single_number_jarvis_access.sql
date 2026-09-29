-- QuickFurno shared-number Jarvis access.
-- Allows the existing transactional Meta WhatsApp provider account to also be
-- proposal-only for Jarvis conversational turns. This does not grant Jarvis
-- provider credentials or business-state authority; Core remains the sole sender.
alter table public.communication_provider_accounts
  drop constraint if exists communication_provider_account_jarvis_role_chk;

alter table public.communication_provider_accounts
  add constraint communication_provider_account_jarvis_role_chk
  check (
    jarvis_access_mode = 'denied'
    or (
      jarvis_access_mode = 'proposal_only'
      and account_role in ('transactional','conversational')
    )
  );
