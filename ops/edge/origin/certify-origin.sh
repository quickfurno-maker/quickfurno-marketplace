#!/usr/bin/env bash
set -euo pipefail

PUBLIC_ALLOWED_PORTS="${QF_ALLOWED_PUBLIC_PORTS:-22 80 443}"
ORIGIN_HOST="${QF_ORIGIN_HOST:-quickfurno.in}"
ORIGIN_IP="${QF_ORIGIN_IP:-}"

fail() { echo "FAIL $*" >&2; exit 1; }
pass() { echo "PASS $*"; }

command -v ss >/dev/null || fail "ss is required"
LISTENERS="$(ss -H -ltn)"

while read -r _ _ _ local _; do
  [[ -z "${local:-}" ]] && continue
  case "$local" in
    0.0.0.0:*|[::]:*|*:*)
      port="${local##*:}"; port="${port//]/}"
      allowed=0
      for p in $PUBLIC_ALLOWED_PORTS; do [[ "$port" == "$p" ]] && allowed=1; done
      [[ $allowed -eq 1 ]] || fail "unexpected public TCP listener on port $port"
      ;;
  esac
done <<< "$LISTENERS"
pass "no unexpected public TCP listeners"

if command -v ufw >/dev/null; then
  ufw status | grep -q '^Status: active' || fail "UFW is installed but inactive"
  pass "UFW active"
fi

# New immutable QuickFurno deployment must keep the Next.js host port loopback-only.
if command -v docker >/dev/null && [[ -f ops/container/compose.production.yml ]]; then
  grep -Fq '"127.0.0.1:${QF_WEB_HOST_PORT:-3000}:3000"' ops/container/compose.production.yml ||
    fail "QuickFurno web compose is not loopback-bound"
  pass "container application binding is loopback-only"
fi

# Once custom AOP/mTLS is active, a direct HTTPS request to the origin IP without a
# client certificate must not reach the application. 4xx/TLS failure is expected.
if [[ -n "$ORIGIN_IP" ]]; then
  code="$(curl -ksS --connect-timeout 5 --max-time 8 --resolve "${ORIGIN_HOST}:443:${ORIGIN_IP}"     -o /dev/null -w '%{http_code}' "https://${ORIGIN_HOST}/" || true)"
  case "$code" in
    2*|3*) fail "direct origin request without client certificate reached application (HTTP $code)" ;;
    *) pass "direct origin request is rejected without edge/client certificate (HTTP ${code:-000})" ;;
  esac
fi

echo "Phase 10 origin-bypass certification PASS"
