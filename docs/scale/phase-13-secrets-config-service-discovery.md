# Phase 13 — Secrets, Config & Service Discovery

## Status

Implementation branch: `feat/scale-phase13-secrets-config-service-discovery`.

Phase 13 makes QuickFurno deployment configuration portable without moving business
policy into infrastructure. The runtime contract is intentionally provider-neutral:
operators inject values or mounted files, and a future external secret manager can
materialize the same files without application code changes.

## Versioned deployment identity

Production roles carry:

- `QF_RUNTIME_ENV=production`
- `QF_CONFIG_SCHEMA_VERSION=1`
- a stable `QF_SERVICE_ID`

Canonical service identities are:

- `quickfurno.web`
- `quickfurno.automation-worker`
- `quickfurno.conversation-transport`
- `quickfurno.aarohi-acquisition`

Production startup fails closed when environment, schema version or service identity
is missing or inconsistent.

## Dotenv boundary

Repository-local dotenv discovery is a local-development convenience only.
Production workers never search `.env.local`, `.env.production` or `.env`.
A production supervisor may inject environment variables directly or set
`QF_ENV_FILE` to one explicit absolute external file.

The legacy PM2 definitions follow the same rule.

## Secret injection

The production entrypoint supports direct-value or mounted-file injection for the
high-value server-only secrets that cross the container boundary. A value and its
matching `*_FILE` path are mutually exclusive. Mounted files must be absolute,
regular, non-symlink and non-empty.

This is the application contract. Docker bind mounts, Kubernetes Secrets, Vault
Agent, AWS Secrets Manager sidecars or another secret manager can all satisfy it
without domain-code changes.

No secret is intentionally baked into an image. The Docker context excludes
`.env*`, and the runtime image receives no server-secret build argument.

## Service discovery

QuickFurno → Jarvis uses `QF_JARVIS_BASE_URL` as deployment configuration.
Non-loopback production targets must be HTTPS DNS names; literal IP hosts are
rejected. Loopback HTTP remains available for local tests.

Moving Jarvis to another host/network therefore changes DNS/configuration rather
than source code.

## Key rotation

The sender key ID and private key file are runtime-supplied. QuickFurno receivers
already accept a bounded set of up to four unique Ed25519 public verification keys.

Zero-downtime rotation sequence:

1. Add the new public key alongside the old verification key.
2. Deploy/reload receivers and prove both signatures verify.
3. Switch senders to the new key ID/private-key file.
4. Prove new-key traffic succeeds.
5. Remove the old public key after the overlap window.

No image rebuild is required.

## Dynamic business policy boundary

Deployment configuration identifies environment, service, endpoints and secrets.
QuickFurno business policy, fair matching, credits, consent, lead assignment,
provider authorization and Jarvis enable/disable policy remain in their existing
authoritative stores/configuration and are not encoded into service discovery.

## Certification

`npm run test:scale:phase13` certifies:

- explicit versioned production identity;
- no production repository-local dotenv search;
- direct-value/mounted-file secret injection and ambiguity refusal;
- fail-closed mandatory security configuration;
- no secret-bearing image build inputs;
- DNS-based Jarvis service discovery and literal-IP refusal;
- config-only endpoint relocation;
- overlapping Ed25519 key rotation followed by new-key-only cutover;
- continued Phase 12 conversation fast-path ownership.

## Deployment and rollback

Phase 13 requires no production cutover to merge. Existing service topology and
business behavior remain unchanged.

Rollback is source/configuration-only: restore the previous image/revision and its
matching environment file. Secret/key material remains external and can be rotated
independently of image rollback.
