# AB-7I B — Staff suspension approval and Auth truth (RELEASE HOLD)

Added an uninstalled, separate signed suspension approval attestation to the real Core atomic Staff revoke SQL. An active TL name/ID is NOT independent approval; exact nonce, target, Owner, TL, team, city and expiry must match a reviewed record. Service role cannot insert the approval. Offline PostgreSQL 17 tests deny spoofed TL and self-issued approvals and verify true atomic membership+department+scope revocation when synthetic trusted review exists.

Corrected the Auth reconciliation contract: Supabase global sign-out may revoke refresh sessions but **existing JWT access tokens remain valid until expiration**. Even after provider confirmation the contract returns `authSessionsInvalidated=false`, `refreshSessionsRevokedVerified=true`; Core protected actions must recheck current Staff memberships/grants. No real Auth user or refresh session was changed.
