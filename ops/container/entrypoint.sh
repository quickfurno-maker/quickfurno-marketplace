#!/bin/sh
set -eu

role="${QF_RUNTIME_ROLE:-web}"

require_env() {
  name="$1"
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "quickfurno-container REFUSED missing required env: $name" >&2
    exit 78
  fi
}

case "$role" in
  web)
    require_env NEXT_PUBLIC_SUPABASE_URL
    require_env NEXT_PUBLIC_SUPABASE_ANON_KEY
    export HOSTNAME="${HOSTNAME:-0.0.0.0}"
    export PORT="${PORT:-3000}"
    exec node server.js
    ;;
  automation-worker)
    require_env NEXT_PUBLIC_SUPABASE_URL
    require_env SUPABASE_SERVICE_ROLE_KEY
    exec node dist/automation-worker.mjs
    ;;
  conversation-transport)
    require_env NEXT_PUBLIC_SUPABASE_URL
    require_env SUPABASE_SERVICE_ROLE_KEY
    exec node dist/conversation-transport-worker.mjs
    ;;
  aarohi-acquisition)
    require_env NEXT_PUBLIC_SUPABASE_URL
    require_env SUPABASE_SERVICE_ROLE_KEY
    exec node dist/aarohi-acquisition-worker.mjs
    ;;
  *)
    echo "quickfurno-container REFUSED unknown runtime role: $role" >&2
    exit 64
    ;;
esac
