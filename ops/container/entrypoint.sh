#!/bin/sh
set -eu

role="${QF_RUNTIME_ROLE:-web}"

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
  *)
    echo "quickfurno-container REFUSED unknown runtime role: $role" >&2
    exit 64
    ;;
esac
