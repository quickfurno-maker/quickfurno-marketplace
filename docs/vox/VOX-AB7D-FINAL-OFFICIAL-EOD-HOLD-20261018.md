# AB-7D Official four-source EOD publication gate — source-only HOLD

- Source-only publication proposal requires four **distinct** signed Core original-source manifests, exact staff/team/city/day, independent current AAL2 TL who has already acknowledged same report and revision, and injected current signature/DB/ack verifier.
- No preview or test fixture can be marked official. Output remains `PENDING_ATOMIC_CORE_PUBLICATION`, `official:false`, `published:false`; the pending real Core publication SQL and genuine signer custody are *not installed*.
- Tests reject missing/duplicated source, forged official card, bad digest/reviewer, stale revision, revoked TL and unavailable Core receipt/signatures.
- Next: independently approved signing keys, DB snapshot/watermark transaction and TL sign-off, real staging. Release HOLD.
