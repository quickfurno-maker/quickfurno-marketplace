#!/usr/bin/env bash
# QuickFurno Scale Phase 15 immutable blue/green release controller.
#
# Source/CI certified in Phase 15. Production use stays disabled until the
# production environment, runner and Nginx include are explicitly cut over.
set -Eeuo pipefail
umask 077

COMMAND="${1:-}"
MANIFEST="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CLI="$ROOT/scripts/scale/phase15-release.mjs"
COMPOSE="$ROOT/ops/container/compose.production.yml"
STATE_ROOT="${QF_PHASE15_STATE_ROOT:-/var/lib/quickfurno-phase15}"
STATE_FILE="$STATE_ROOT/state.json"
STAGED_MANIFEST="$STATE_ROOT/staged-manifest.json"
CURRENT_MANIFEST="$STATE_ROOT/current-manifest.json"
PREVIOUS_MANIFEST="$STATE_ROOT/previous-manifest.json"
LOCK_FILE="$STATE_ROOT/release.lock"
BLUE_PORT="${QF_PHASE15_BLUE_PORT:-3101}"
GREEN_PORT="${QF_PHASE15_GREEN_PORT:-3102}"
SWITCH_ADAPTER="${QF_PHASE15_SWITCH_ADAPTER:-$HERE/nginx-switch.sh}"
PUBLIC_SMOKE_URL="${QF_PHASE15_PUBLIC_SMOKE_URL:-}"
ENV_FILE="${QF_ENV_FILE:-}"
AAROHI_ENABLED="${QF_PHASE15_AAROHI_ENABLED:-0}"

die() { echo "PHASE15_REFUSED: $1" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
usage:
  blue-green.sh stage <phase15-release.json>
  blue-green.sh promote
  blue-green.sh rollback
  blue-green.sh status

Required host configuration:
  QF_ENV_FILE=/absolute/path/to/production.env
  QF_PHASE15_PUBLIC_SMOKE_URL=https://quickfurno.in/livez
The public Nginx location must already include the Phase-15 active-upstream file.
EOF
  exit 2
}

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "must run as root on the approved deployment host"
}

prepare_state_root() {
  [[ ! -L "$STATE_ROOT" ]] || die "state root must not be a symlink"
  install -d -o 0 -g 0 -m 0700 "$STATE_ROOT"
  [[ -d "$STATE_ROOT" && ! -L "$STATE_ROOT" ]] || die "state root invalid"
  touch "$LOCK_FILE"
  chmod 0600 "$LOCK_FILE"
}

lock_release() {
  exec 9>"$LOCK_FILE"
  flock -x 9
}

slot_port() {
  case "$1" in
    blue) printf '%s\n' "$BLUE_PORT" ;;
    green) printf '%s\n' "$GREEN_PORT" ;;
    *) die "invalid slot: $1" ;;
  esac
}

manifest_value() {
  local file="$1" field="$2"
  node -e '
    const fs=require("node:fs");
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const field=process.argv[2];
    if(field==="sha") console.log(j.sourceSha);
    else if(field==="release") console.log(j.releaseId);
    else if(field==="image") console.log(j.images.find((x)=>x.role==="quickfurno-runtime").ref);
    else throw new Error("field");
  ' "$file" "$field"
}

state_value() {
  local field="$1"
  [[ -f "$STATE_FILE" ]] || { printf '\n'; return; }
  node -e '
    const fs=require("node:fs");
    const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const v=j[process.argv[2]];
    console.log(v===null||v===undefined?"":v);
  ' "$STATE_FILE" "$field"
}

validate_manifest() {
  local file="$1"
  [[ -f "$file" && ! -L "$file" ]] || die "manifest must be a regular non-symlink file"
  node "$CLI" validate --manifest "$file" --system QUICKFURNO --promotable
}

plan_target() {
  local file="$1"
  if [[ -f "$STATE_FILE" ]]; then
    node "$CLI" plan --manifest "$file" --state "$STATE_FILE" --system QUICKFURNO
  else
    node "$CLI" plan --manifest "$file" --system QUICKFURNO
  fi
}

plan_slot() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).targetSlot));'
}

compose_for() {
  local slot="$1" manifest="$2"
  shift 2
  local image sha port
  image="$(manifest_value "$manifest" image)"
  sha="$(manifest_value "$manifest" sha)"
  port="$(slot_port "$slot")"
  [[ -n "$ENV_FILE" && "$ENV_FILE" = /* && -f "$ENV_FILE" ]] || die "QF_ENV_FILE must be an existing absolute file"
  env \
    QF_IMAGE_REF="$image" \
    QF_RELEASE_SHA="$sha" \
    QF_WEB_HOST_PORT="$port" \
    QF_ENV_FILE="$ENV_FILE" \
    docker compose -p "quickfurno-$slot" -f "$COMPOSE" "$@"
}

wait_web_healthy() {
  local slot="$1" manifest="$2" port container status
  port="$(slot_port "$slot")"
  container="$(compose_for "$slot" "$manifest" ps -q web)"
  [[ -n "$container" ]] || die "slot $slot web container missing"
  status=unknown
  for _ in $(seq 1 60); do
    status="$(docker inspect "$container" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
    [[ "$status" == "healthy" ]] && break
    sleep 2
  done
  [[ "$status" == "healthy" ]] || die "slot $slot did not become healthy ($status)"
  curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$port/livez" >/dev/null
  curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$port/readyz" >/dev/null
}

verify_image_identity() {
  local manifest="$1" image sha actual
  image="$(manifest_value "$manifest" image)"
  sha="$(manifest_value "$manifest" sha)"
  [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || die "image is not digest pinned"
  docker pull "$image" >/dev/null
  actual="$(docker image inspect "$image" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
  [[ "$actual" == "$sha" ]] || die "image revision $actual does not match manifest source $sha"
}

activate_workers() {
  local slot="$1" manifest="$2"
  compose_for "$slot" "$manifest" up -d automation-worker conversation-transport
  for service in automation-worker conversation-transport; do
    local id
    id="$(compose_for "$slot" "$manifest" ps -q "$service")"
    [[ -n "$id" ]] || die "$service missing in slot $slot"
    [[ "$(docker inspect "$id" --format '{{.State.Running}}')" == "true" ]] ||
      die "$service not running in slot $slot"
  done
  if [[ "$AAROHI_ENABLED" == "1" ]]; then
    compose_for "$slot" "$manifest" --profile aarohi up -d aarohi-acquisition
    local id
    id="$(compose_for "$slot" "$manifest" --profile aarohi ps -q aarohi-acquisition)"
    [[ -n "$id" && "$(docker inspect "$id" --format '{{.State.Running}}')" == "true" ]] ||
      die "aarohi-acquisition not running in slot $slot"
  fi
}

stop_workers() {
  local slot="$1" manifest="$2"
  compose_for "$slot" "$manifest" stop automation-worker conversation-transport >/dev/null
  if [[ "$AAROHI_ENABLED" == "1" ]]; then
    compose_for "$slot" "$manifest" --profile aarohi stop aarohi-acquisition >/dev/null
  fi
}

public_smoke() {
  [[ "$PUBLIC_SMOKE_URL" == https://* ]] || die "QF_PHASE15_PUBLIC_SMOKE_URL must be an https URL"
  curl --fail --silent --show-error --location --max-time 10 --retry 2 "$PUBLIC_SMOKE_URL" >/dev/null
}

switch_traffic() {
  local slot="$1" manifest="$2" port sha
  [[ -x "$SWITCH_ADAPTER" ]] || die "switch adapter is not executable: $SWITCH_ADAPTER"
  port="$(slot_port "$slot")"
  sha="$(manifest_value "$manifest" sha)"
  "$SWITCH_ADAPTER" "$slot" "$port" "$sha"
}

write_state() {
  local current_slot="$1" current_manifest="$2" previous_slot="$3" previous_manifest="$4"
  local cr cs ch pr ps ph
  cr="$(manifest_value "$current_manifest" release)"
  cs="$(manifest_value "$current_manifest" sha)"
  ch="$(sha256sum "$current_manifest" | awk '{print $1}')"
  if [[ -n "$previous_slot" && -f "$previous_manifest" ]]; then
    pr="$(manifest_value "$previous_manifest" release)"
    ps="$(manifest_value "$previous_manifest" sha)"
    ph="$(sha256sum "$previous_manifest" | awk '{print $1}')"
  else
    previous_slot=""
    pr=""
    ps=""
    ph=""
  fi
  node - "$STATE_FILE.tmp" "$current_slot" "$cr" "$cs" "$ch" "$previous_slot" "$pr" "$ps" "$ph" <<'NODE'
const fs=require('node:fs');
const [out,currentSlot,currentReleaseId,currentSourceSha,currentManifestSha256,previousSlot,previousReleaseId,previousSourceSha,previousManifestSha256]=process.argv.slice(2);
const nullable=(v)=>v===''?null:v;
const state={
  protocol:'qf.release.state.v1',
  activeSlot:nullable(currentSlot),
  currentReleaseId:nullable(currentReleaseId),
  currentSourceSha:nullable(currentSourceSha),
  currentManifestSha256:nullable(currentManifestSha256),
  previousSlot:nullable(previousSlot),
  previousReleaseId:nullable(previousReleaseId),
  previousSourceSha:nullable(previousSourceSha),
  previousManifestSha256:nullable(previousManifestSha256),
};
fs.writeFileSync(out,JSON.stringify(state,null,2)+'\n',{mode:0o600});
NODE
  chmod 0600 "$STATE_FILE.tmp"
  mv -f "$STATE_FILE.tmp" "$STATE_FILE"
}

stage_release() {
  [[ -n "$MANIFEST" ]] || usage
  validate_manifest "$MANIFEST"
  verify_image_identity "$MANIFEST"
  local plan target
  plan="$(plan_target "$MANIFEST")"
  target="$(printf '%s' "$plan" | plan_slot)"
  echo "==> staging QuickFurno release $(manifest_value "$MANIFEST" release) into $target"
  compose_for "$target" "$MANIFEST" up -d web
  wait_web_healthy "$target" "$MANIFEST"
  install -o 0 -g 0 -m 0600 "$MANIFEST" "$STAGED_MANIFEST.tmp"
  mv -f "$STAGED_MANIFEST.tmp" "$STAGED_MANIFEST"
  echo "PHASE15_STAGED slot=$target source=$(manifest_value "$MANIFEST" sha)"
}

promote_release() {
  [[ -f "$STAGED_MANIFEST" ]] || die "no staged manifest"
  validate_manifest "$STAGED_MANIFEST"
  verify_image_identity "$STAGED_MANIFEST"
  local plan target active
  plan="$(plan_target "$STAGED_MANIFEST")"
  target="$(printf '%s' "$plan" | plan_slot)"
  active="$(state_value activeSlot)"
  wait_web_healthy "$target" "$STAGED_MANIFEST"

  echo "==> switching public traffic $active -> $target"
  if ! switch_traffic "$target" "$STAGED_MANIFEST" || ! public_smoke; then
    echo "PHASE15_PROMOTION_SMOKE_FAILED" >&2
    if [[ -n "$active" && -f "$CURRENT_MANIFEST" ]]; then
      switch_traffic "$active" "$CURRENT_MANIFEST" || true
    fi
    die "traffic switch failed; previous slot restored when available"
  fi

  echo "==> traffic verified; activating target workers"
  if ! activate_workers "$target" "$STAGED_MANIFEST"; then
    echo "PHASE15_WORKER_ACTIVATION_FAILED" >&2
    stop_workers "$target" "$STAGED_MANIFEST" || true
    if [[ -n "$active" && -f "$CURRENT_MANIFEST" ]]; then
      if switch_traffic "$active" "$CURRENT_MANIFEST" && public_smoke; then
        activate_workers "$active" "$CURRENT_MANIFEST" || true
      fi
    fi
    die "target workers failed; previous traffic/worker generation restored when available"
  fi

  if [[ -n "$active" && -f "$CURRENT_MANIFEST" ]]; then
    echo "==> draining previous workers; previous web remains warm for rollback"
    stop_workers "$active" "$CURRENT_MANIFEST"
    cp -f "$CURRENT_MANIFEST" "$PREVIOUS_MANIFEST.tmp"
    chmod 0600 "$PREVIOUS_MANIFEST.tmp"
    mv -f "$PREVIOUS_MANIFEST.tmp" "$PREVIOUS_MANIFEST"
  else
    rm -f "$PREVIOUS_MANIFEST"
  fi

  cp -f "$STAGED_MANIFEST" "$CURRENT_MANIFEST.tmp"
  chmod 0600 "$CURRENT_MANIFEST.tmp"
  mv -f "$CURRENT_MANIFEST.tmp" "$CURRENT_MANIFEST"
  write_state "$target" "$CURRENT_MANIFEST" "$active" "$PREVIOUS_MANIFEST"
  rm -f "$STAGED_MANIFEST"
  echo "PHASE15_PROMOTED slot=$target source=$(manifest_value "$CURRENT_MANIFEST" sha)"
}

rollback_release() {
  [[ -f "$STATE_FILE" && -f "$CURRENT_MANIFEST" && -f "$PREVIOUS_MANIFEST" ]] ||
    die "rollback requires current and previous signed release state"
  local active previous
  active="$(state_value activeSlot)"
  previous="$(state_value previousSlot)"
  [[ -n "$active" && -n "$previous" && "$active" != "$previous" ]] || die "rollback slots invalid"
  validate_manifest "$PREVIOUS_MANIFEST"
  verify_image_identity "$PREVIOUS_MANIFEST"
  wait_web_healthy "$previous" "$PREVIOUS_MANIFEST"

  echo "==> rolling public traffic back $active -> $previous"
  switch_traffic "$previous" "$PREVIOUS_MANIFEST"
  if ! public_smoke; then
    switch_traffic "$active" "$CURRENT_MANIFEST" || true
    die "rollback smoke failed; current slot restored"
  fi

  activate_workers "$previous" "$PREVIOUS_MANIFEST"
  stop_workers "$active" "$CURRENT_MANIFEST"

  mv "$CURRENT_MANIFEST" "$STATE_ROOT/swap-current.json"
  mv "$PREVIOUS_MANIFEST" "$CURRENT_MANIFEST"
  mv "$STATE_ROOT/swap-current.json" "$PREVIOUS_MANIFEST"
  write_state "$previous" "$CURRENT_MANIFEST" "$active" "$PREVIOUS_MANIFEST"
  echo "PHASE15_ROLLED_BACK slot=$previous source=$(manifest_value "$CURRENT_MANIFEST" sha)"
}

status_release() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE"
  else
    echo '{"protocol":"qf.release.state.v1","activeSlot":null}'
  fi
}

require_root
prepare_state_root
lock_release

case "$COMMAND" in
  stage) stage_release ;;
  promote) promote_release ;;
  rollback) rollback_release ;;
  status) status_release ;;
  *) usage ;;
esac
