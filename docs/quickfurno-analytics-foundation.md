# QuickFurno Analytics Foundation

## What was created

- Admin analytics display foundation at `/admin/analytics` through the existing admin section route.
- Overview analytics cards for total leads, leads today, conversion rate placeholder, revenue placeholder, active vendors, paid vendors, follow-ups due, and AOS events placeholder.
- Lead source analytics placeholders for website, google_ads, meta_ads, whatsapp, manual, referral, organic_seo, and justdial competitor tracking placeholder.
- Campaign analytics placeholder table with campaign name, source, spend placeholder, leads, CPL placeholder, and conversion placeholder.
- CRM funnel analytics for new, qualified, assigned, contacted, site_visit_scheduled, quotation_sent, won, and lost.
- Service analytics for interiors, carpentry, modular kitchen, sofa, painting, and civil work.
- City and area analytics with city, area/locality, lead count, vendor count, and demand/supply placeholder.
- Vendor analytics with vendor name, assigned leads, response rate placeholder, package, status, and lead balance placeholder.
- Revenue analytics placeholders for package revenue, pending payments, expired packages, renewals due, and monthly revenue.
- AOS agent analytics placeholders for LeadLens, TrustShield, MatchForge, LeadFlow, ClientCare, and OpsBrief.
- Safe analytics adapter at `lib/analytics/analyticsAdapter.ts`.
- Analytics types in `lib/analytics/types/index.ts`.

## What is placeholder

- Campaign spend.
- CPL.
- Conversion rate.
- Revenue.
- Demand/supply calculations.
- Vendor response rate.
- Lead balance analytics.
- AOS agent event analytics.

## What is not active yet

- No ad platform connection.
- No payment gateway connection.
- No AOS event persistence.
- No n8n webhook call.
- No WhatsApp sending.
- No credit deduction.
- No automatic lead assignment.
- No database migration was applied from this implementation.

## Future activation steps

1. Review and apply the migration through the approved Supabase deployment flow.
2. Backfill lead source and UTM attribution after consent and tracking rules are approved.
3. Connect Google Ads and Meta spend through read-only reporting credentials.
4. Connect package/payment revenue through approved payment records.
5. Persist AOS events only after agent run logging is approved.
6. Add analytics tests before using metrics for paid ads decisions.

## Safety rules

- Analytics pages must remain display-only until activation.
- Placeholder financial values must not be treated as real revenue or spend.
- Do not call n8n or WhatsApp from analytics pages.
- Do not mutate leads, vendors, packages, credits, or payments from analytics pages.
- Do not expose secrets or edit `.env` files.
