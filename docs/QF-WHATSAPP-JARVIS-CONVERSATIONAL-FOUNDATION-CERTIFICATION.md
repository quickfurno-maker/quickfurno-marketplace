# QF WhatsApp / Jarvis Conversational Foundation — Database Certification

**Migration:** `20260918120000_whatsapp_conversational_jarvis_foundation.sql`  
**SHA-256:** `4d33c0f1fc490b6ca3ba254aea6d5e4ee816bb31292ff3651aaf8f99d075f9f7`  
**Date:** 2026-09-18

## Scope

This record certifies the database foundation only. It creates no Meta credential, sends no WhatsApp message, and does not enable `QF_JARVIS_WHATSAPP_ENABLED`. QuickFurno remains the provider/send authority.

## Staging

Project ref: `uckafzuochmbvtiodmcl`.

The migration applied successfully. The Supabase migration API initially recorded the generated version `20260918124033`; after confirming that the canonical target version was free and that the DDL had already applied successfully, only the migration-history version was aligned to the repository version `20260918120000`. The DDL was not re-run.

Independent relist after alignment:
- remote migration history count: **43**
- `20260918120000 / whatsapp_conversational_jarvis_foundation`: present exactly once
- new conversation/outbox/event tables: present
- all four new tables: RLS enabled
- browser roles: no table grants
- service role: only the migration-declared bounded grants

The sole staging Meta account remained the Core account:
- alias `core`
- role `transactional`
- Jarvis access `denied`
- default transactional account: true

No staging conversational provider account was created because the existing staging provider record already carries the same phone-number reference used by the production conversational number under a different WABA. That ambiguity is intentionally not overwritten by this certification.

## Production

Project ref: `yqpgcsduqbxulrlzwzap`.

The migration applied successfully. The Supabase migration API initially recorded generated version `20260918134441`; after the same exact-version safety check, only migration history was aligned to `20260918120000`. The DDL was not re-run.

Independent relist after alignment:
- remote migration history count: **51**
- `20260918120000 / whatsapp_conversational_jarvis_foundation`: present exactly once
- new conversation/outbox/event tables: present with zero rows at certification
- all four new tables: RLS enabled
- browser roles: no table grants
- service role: only the migration-declared bounded grants

Provider-account verification after application:
- Core account: `core / transactional / denied / default=true`
- Conversational account: `riya / conversational / proposal_only / default=true`
- conversational WABA: `1569174604351612`
- conversational phone-number ID: `1088396637681784`
- conversational runtime readiness remains `disabled`
- conversational configuration remains `partial` until application secrets/deployment are installed

The production conversational provider row was inserted only after proving that neither its WABA, phone-number ID nor alias already existed.

## Security posture

The migration introduced no provider credential column and no direct Jarvis send authority. Destination and reply bodies remain sealed; Jarvis can only propose a reply, and QuickFurno rechecks conversation state, revision, suppression and service-window authority before any Meta send.

Supabase Security Advisor still reports pre-existing project-level findings unrelated to these four new service-role-only tables. No new browser access was introduced by this migration.

## Remaining non-database gates

Database application does not mean the feature is live. Application deployment, conversational environment configuration, Meta callback verification, Jarvis ingress deployment, provider/runtime production approval, and real inbound/two-way canaries remain separate gates.
