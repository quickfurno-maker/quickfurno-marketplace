#!/usr/bin/env bash
# =============================================================================
# QuickFurno - QF-MVP-80.14C production lead-assignment dispatch trigger.
#
# Canonical source. Deployed to /usr/local/sbin/qf-lead-assignment-dispatch
# (root-owned, chmod 700) and invoked ONLY by
# /etc/cron.d/quickfurno-lead-assignment-dispatch.
#
# THIS IS A TRIGGER, NOT AN AUTHORITY.
#
# It makes exactly one authenticated POST to the Core internal route and does
# nothing else. It holds no SQL, no Supabase client, no Meta call, no n8n call,
# no template, no recipient, no retry and no activation boundary. Every business
# decision - which intent, which vendor, which template, which provider, consent,
# runtime policy, provider readiness, canary enforcement, idempotency and the
# forward-only activation boundary that parks the six historical intents - stays
# inside the already-merged QF-MVP-80.13A/80.13B stack and is re-derived inside
# Core on every run.
#
# The only value it sends is a FIXED launch batch size. It is not caller-tunable
# from cron, and the route independently clamps to [1,25] regardless.
#
# SECRET HANDLING: QF_CRON_SECRET is read at execution time from the
# root-protected runtime env file. It is never echoed, never logged, never
# passed on the command line (which would expose it in /proc and in `ps`), and
# never written to the log. curl reads the header from a file descriptor, so the
# value never appears in the process table.
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

# Never trace: `set -x` would print the secret.
set +x

readonly ENV_FILE="/etc/quickfurno/quickfurno-runtime.env"
readonly ENDPOINT="https://quickfurno.in/api/internal/process-lead-assignment-intents"
readonly LOCK_FILE="/var/lock/qf-lead-assignment-dispatch.lock"
readonly LOG_TAG="qf-lead-assignment-dispatch"

# The FIXED launch batch. QuickFurno assigns at most 3 vendors per lead, so one
# tick covers a whole lead without enlarging the first-launch blast radius.
readonly BATCH_LIMIT=3

readonly CONNECT_TIMEOUT=5
readonly MAX_TIME=25

# Sanitized operational logging only. No secret, no phone, no provider message
# id, no header, no response body beyond the four counters.
log() { logger -t "$LOG_TAG" -- "$*" 2>/dev/null || printf '%s %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$LOG_TAG" "$*" >&2; }

fail() { log "result=error status=$1 detail=$2"; exit "${3:-1}"; }

# --- overlap fence --------------------------------------------------------
# flock -n: a tick that arrives while the previous one is still running exits
# immediately rather than running a second concurrent dispatch.
exec 9>"$LOCK_FILE" || fail "lock_open_failed" "cannot open lock file" 1
if ! flock -n 9; then
  log "result=skipped status=locked detail=previous_run_still_active"
  exit 0
fi

# --- secret ---------------------------------------------------------------
[ -r "$ENV_FILE" ] || fail "env_unreadable" "runtime env file missing or unreadable" 2

# Read only the one variable, from the last matching line. The value is never
# printed and never exported into the wider environment.
QF_CRON_SECRET="$(sed -n 's/^QF_CRON_SECRET=//p' "$ENV_FILE" | tail -n 1)"
QF_CRON_SECRET="${QF_CRON_SECRET%\"}"; QF_CRON_SECRET="${QF_CRON_SECRET#\"}"
QF_CRON_SECRET="${QF_CRON_SECRET%\'}"; QF_CRON_SECRET="${QF_CRON_SECRET#\'}"

if [ -z "${QF_CRON_SECRET:-}" ]; then
  unset QF_CRON_SECRET
  fail "secret_absent" "QF_CRON_SECRET missing or blank" 2
fi

# --- the one request ------------------------------------------------------
# --retry 0 : no automatic retry. A failed tick is simply reported; the next
#             scheduled tick is the only "retry", and Core's idempotency makes
#             a repeat harmless.
# The secret is supplied via process substitution so it never appears in argv.
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
start_ns="$(date +%s%N)"

http_body=""
http_status=""
set +e
response="$(
  curl --silent --show-error \
       --request POST \
       --url "$ENDPOINT" \
       --header @<(printf 'x-qf-cron-secret: %s\n' "$QF_CRON_SECRET") \
       --header 'Content-Type: application/json' \
       --header 'Accept: application/json' \
       --data "{\"limit\":${BATCH_LIMIT}}" \
       --retry 0 \
       --connect-timeout "$CONNECT_TIMEOUT" \
       --max-time "$MAX_TIME" \
       --write-out '\n%{http_code}' \
       2>/dev/null
)"
curl_rc=$?
set -e

# The secret's job is done; drop it before any parsing or logging happens.
unset QF_CRON_SECRET

end_ns="$(date +%s%N)"
duration_ms=$(( (end_ns - start_ns) / 1000000 ))

[ "$curl_rc" -eq 0 ] || fail "transport_failed" "curl_rc=$curl_rc duration_ms=$duration_ms" 3

http_status="${response##*$'\n'}"
http_body="${response%$'\n'*}"

[ "$http_status" = "200" ] || fail "http_$http_status" "duration_ms=$duration_ms" 4

# --- response contract ----------------------------------------------------
# Only the exact sanitized shape is accepted. Anything else is refused rather
# than logged, so a changed or proxied response can never be mistaken for work.
command -v jq >/dev/null 2>&1 || fail "jq_missing" "jq required to validate response" 5

echo "$http_body" | jq -e 'type == "object"' >/dev/null 2>&1 \
  || fail "malformed_json" "duration_ms=$duration_ms" 6

contract_ok="$(
  echo "$http_body" | jq -r '
    if (. | keys | sort) == ["dispatched","ok","refused","selected","selectionBlocked"]
       and (.ok | type) == "boolean"
       and (.selected | type) == "number"
       and (.dispatched | type) == "number"
       and (.refused | type) == "number"
       and (.selectionBlocked | type) == "boolean"
    then "yes" else "no" end' 2>/dev/null || echo "no"
)"
[ "$contract_ok" = "yes" ] || fail "contract_violation" "unexpected response shape duration_ms=$duration_ms" 7

ok="$(echo "$http_body"        | jq -r '.ok')"
selected="$(echo "$http_body"  | jq -r '.selected')"
dispatched="$(echo "$http_body"| jq -r '.dispatched')"
refused="$(echo "$http_body"   | jq -r '.refused')"
blocked="$(echo "$http_body"   | jq -r '.selectionBlocked')"

[ "$ok" = "true" ] || fail "route_not_ok" "duration_ms=$duration_ms" 8

log "result=success started_at=$started_at status=200 selected=$selected dispatched=$dispatched refused=$refused selectionBlocked=$blocked duration_ms=$duration_ms"
exit 0
