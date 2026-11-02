# AB-7C Conversation pause boundary — source-only HOLD

- Based on Core draft #356 exact SHA `0e20c628fb31e61339bdeb8d37bd590857cace0f`.
- New `prepareCanonicalCorePause` checks a narrow, non-executable scoped Staff proposal against exact current conversation revision, verified neutral AAL2 client-success Staff, object grant, separately verified signed Jarvis pause, and a **trusted canonical** consent/suppression snapshot bound to subject and destination.
- Strict expiry (15 seconds) and exact snapshot schema; never treats synthetic `vox_ab7b_current_consent_candidate_v1` as consent truth. Existing Core `communication_conversations` and `communication_conversation_events` currently have split mutations; no route or SQL writer was changed.
- **Not completed:** protected durable consent binding/real Core SQL same-transaction update + original event + F1 + one-use nonce, private M2M verification, independent AppSec/DBA review, real staging AAL2.
- Returns only `PENDING_CANONICAL_CORE_ATOMIC_RECHECK`, `mayExecute:false`. No conversation updates, takeover, resume, provider send, managed DB change or release.
- Focused tests cover signatures, stale/revoked consent, forged principal, expired snapshot, permission and revision failures. Release HOLD.
