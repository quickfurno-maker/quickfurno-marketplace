#!/bin/sh
set -eu

role="${QF_RUNTIME_ROLE:-web}"
runtime_env="${QF_RUNTIME_ENV:-}"
schema_version="${QF_CONFIG_SCHEMA_VERSION:-}"
service_id="${QF_SERVICE_ID:-}"

case "$role" in
  web) expected_service_id="quickfurno.web" ;;
  automation-worker) expected_service_id="quickfurno.automation-worker" ;;
  conversation-transport) expected_service_id="quickfurno.conversation-transport" ;;
  aarohi-acquisition) expected_service_id="quickfurno.aarohi-acquisition" ;;
  *)
    echo "quickfurno-container REFUSED unknown runtime role: $role" >&2
    exit 64
    ;;
esac

if [ "$runtime_env" != "production" ]; then
  echo "quickfurno-container REFUSED QF_RUNTIME_ENV must be production" >&2
  exit 78
fi
if [ "$schema_version" != "1" ]; then
  echo "quickfurno-container REFUSED unsupported QF_CONFIG_SCHEMA_VERSION" >&2
  exit 78
fi
if [ "$service_id" != "$expected_service_id" ]; then
  echo "quickfurno-container REFUSED invalid QF_SERVICE_ID" >&2
  exit 78
fi

load_secret_file() {
  value_name="$1"
  file_name="$2"
  eval "value=\${$value_name:-}"
  eval "file=\${$file_name:-}"
  if [ -n "$value" ] && [ -n "$file" ]; then
    echo "quickfurno-container REFUSED both $value_name and $file_name are configured" >&2
    exit 78
  fi
  [ -z "$file" ] && return 0
  case "$file" in
    /*) ;;
    *)
      echo "quickfurno-container REFUSED $file_name must be absolute" >&2
      exit 78
      ;;
  esac
  if [ ! -f "$file" ] || [ -L "$file" ]; then
    echo "quickfurno-container REFUSED invalid secret file: $file_name" >&2
    exit 78
  fi
  secret="$(cat "$file")"
  if [ -z "$secret" ]; then
    echo "quickfurno-container REFUSED empty secret file: $file_name" >&2
    exit 78
  fi
  export "$value_name=$secret"
}

# Portable secret-manager boundary: an operator may inject these values directly
# or mount a file and set the matching *_FILE path. Domain code stays provider-neutral.
load_secret_file SUPABASE_SERVICE_ROLE_KEY SUPABASE_SERVICE_ROLE_KEY_FILE
load_secret_file WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN WHATSAPP_CONVERSATIONAL_ACCESS_TOKEN_FILE
load_secret_file QF_CONVERSATION_SEAL_KEYS QF_CONVERSATION_SEAL_KEYS_FILE
load_secret_file QF_CONSENT_ACK_DESTINATION_KEYS QF_CONSENT_ACK_DESTINATION_KEYS_FILE
load_secret_file SEND_SMS_HOOK_SECRETS SEND_SMS_HOOK_SECRETS_FILE

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
