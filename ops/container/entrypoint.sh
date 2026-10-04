#!/bin/sh
set -eu

role="${QF_RUNTIME_ROLE:-web}"

case "$role" in
  web|automation-worker|conversation-transport|aarohi-acquisition)
    ;;
  *)
    echo "quickfurno-container REFUSED unknown runtime role: $role" >&2
    exit 64
    ;;
esac

if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  echo "quickfurno-container REFUSED missing mandatory config: NEXT_PUBLIC_SUPABASE_URL" >&2
  exit 78
fi
if [ -z "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" ]; then
  echo "quickfurno-container REFUSED missing mandatory config: NEXT_PUBLIC_SUPABASE_ANON_KEY" >&2
  exit 78
fi
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "quickfurno-container REFUSED missing mandatory config: SUPABASE_SERVICE_ROLE_KEY" >&2
  exit 78
fi

case "$role" in
  web)
    export HOSTNAME="${HOSTNAME:-0.0.0.0}"
    export PORT="${PORT:-3000}"
    exec node server.js
    ;;
  automation-worker)
    exec node dist/automation-worker.mjs
    ;;
  conversation-transport)
    exec node dist/conversation-transport-worker.mjs
    ;;
  aarohi-acquisition)
    exec node dist/aarohi-acquisition-worker.mjs
    ;;
esac
