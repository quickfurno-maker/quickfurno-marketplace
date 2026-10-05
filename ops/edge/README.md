# Phase 10 — Cloudflare Edge + Portable Origin Protection

Cloudflare is the public edge, not the business-security authority. QuickFurno must
remain secure if Cloudflare is replaced or bypassed during an approved emergency.

## Ownership

- Cloudflare: DNS/CDN, managed WAF, DDoS absorption, endpoint-specific edge limits.
- Origin gateway: TLS, optional mTLS/AOP, public listener policy, HSTS after TLS proof.
- Application: authentication, authorization, identity/business rate limits,
  validation, idempotency, provider quotas and signed internal APIs.
- PostgreSQL: durable business authority.
- Redis/Valkey: ephemeral shared coordination only.

`policy/edge-policy.json` is the provider-neutral contract. `cloudflare/` is one
implementation of that contract.

## Safe activation order

1. Inventory the current Cloudflare zone and export/import every existing entry-point
   ruleset for the phases managed here. Never apply a fresh zone ruleset blindly.
2. Run the repository Phase 10 contract.
3. Review `terraform plan` with both activation switches still false.
4. Enable managed WAF, review/apply, and confirm no application regression.
5. Enable endpoint rate/cache/custom rules, review/apply, and smoke test.
6. Put the origin behind Full (strict) TLS and a custom zone/per-hostname AOP client
   certificate (or an equivalent portable mTLS client certificate).
7. Activate the reviewed origin-gateway mTLS configuration.
8. Activate host firewall rules only after SSH access and rollback access are proven.
9. Run `origin/certify-origin.sh` from the origin and an external host.
10. Roll CSP out as Report-Only and collect violations before any enforcement.
    Jarvis OS is excluded from static edge CSP because it owns a per-request nonce CSP.
11. Enable HSTS only after HTTPS and certificate recovery are proven end to end.

## Emergency bypass

An emergency bypass is an alternate approved gateway path, never a direct application
port. It may temporarily bypass Cloudflare, but it MUST retain application
authentication/authorization, Redis-backed identity limits, request/body limits,
internal signing and PostgreSQL idempotency.

Never publish Next.js, worker, PostgreSQL, Redis/Valkey or internal Jarvis ports to
`0.0.0.0` as a bypass mechanism.

## Cloudflare Terraform note

A Cloudflare zone has one entry-point ruleset per phase. Terraform therefore needs to
own the complete phase entry point. Existing dashboard-created rules must be imported
or reconciled before `enable_managed_waf` or `enable_edge_rules` is set to true.

Secrets are supplied through environment/secret storage. No Cloudflare token, origin
private key, client certificate private key, database credential or Redis credential
belongs in this repository.
