# VOX-14 trusted Core authorization endpoint — SOURCE ONLY

The independent default-OFF Core endpoint `POST /api/vox/v1/agent-subject-access` provides the live Core decision needed before Jarvis exposes signed replay-once agent status. It is not a new bearer authority, WhatsApp sender, memory manager or business execution path.

- Requires real Supabase Auth `getUser` and AAL2 plus Core-active staff/team/city/object grants. Request accepts only `agent,subjectType,subjectId,revision`.
- Rechecks canonical `aarohi_prospects.city_id` and takeover, or live vendor plus active canonical service-zone/city; requires exactly one granted HUMAN conversation matching subject, takeover and revision.
- Only replies with `qf.vox.agent.subject.access.v1` (safe identity/authorization booleans and READ_ONLY), no phone, user token, transcript or memory.
- `VOX_AGENT_SUBJECT_AUTH_ENABLED` defaults OFF. Jarvis transport, signed staging deployment and trusted inter-service bearer architecture remain unc ertified. Core/ Jarvis source unit tests are not full runtime attestations.
- Do not enable before private staging backup/migrations, real AAL2 MFA, current revocation/city tests, replay concurrency, monitoring and rollback.
