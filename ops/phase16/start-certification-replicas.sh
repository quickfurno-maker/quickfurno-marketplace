#!/usr/bin/env bash
set -euo pipefail

SOURCE_SHA="${1:?source SHA is required}"
IMAGE_TAG="qf-phase16:${SOURCE_SHA}"

start_replica() {
  local name="$1"
  local host_label="$2"
  local host_port="$3"

  docker run -d --name "${name}" \
    --label "qf.phase16.host=${host_label}" \
    -p "127.0.0.1:${host_port}:3000" \
    -e QF_RUNTIME_ENV=production \
    -e QF_CONFIG_SCHEMA_VERSION=1 \
    -e QF_SERVICE_ID=quickfurno.web \
    -e QF_RELEASE_SHA="${SOURCE_SHA}" \
    -e HOSTNAME=0.0.0.0 \
    -e NEXT_PUBLIC_SUPABASE_URL=https://phase16-runtime.invalid \
    -e NEXT_PUBLIC_SUPABASE_ANON_KEY=phase16-ci-only-anon-key \
    -e SUPABASE_SERVICE_ROLE_KEY=phase16-ci-only-service-role-key \
    "${IMAGE_TAG}"
}

start_replica qf-phase16-host-a-web a 3211
start_replica qf-phase16-host-b-web b 3212

for port in 3211 3212; do
  ready=0
  for _ in $(seq 1 60); do
    if curl -fsS "http://127.0.0.1:${port}/readyz" >/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "${ready}" != "1" ]]; then
    echo "Phase16 replica on port ${port} never became ready" >&2
    exit 1
  fi
done
