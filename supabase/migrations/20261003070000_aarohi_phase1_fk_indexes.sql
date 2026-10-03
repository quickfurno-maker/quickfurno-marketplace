-- Aarohi Phase 1 post-apply performance hardening.
-- Cover new foreign keys reported by the staging database advisor.

create index if not exists aarohi_registration_intents_vendor_idx
  on public.aarohi_registration_intents(vendor_id)
  where vendor_id is not null;

create index if not exists aarohi_vendor_conversion_registration_intent_idx
  on public.aarohi_vendor_conversion_links(registration_intent_id)
  where registration_intent_id is not null;

create index if not exists aarohi_whatsapp_intakes_city_idx
  on public.aarohi_whatsapp_intakes(city_id);

create index if not exists aarohi_whatsapp_intakes_prospect_idx
  on public.aarohi_whatsapp_intakes(prospect_id)
  where prospect_id is not null;
