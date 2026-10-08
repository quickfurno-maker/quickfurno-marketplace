#!/usr/bin/env bash
# One-time, fail-closed host bootstrap for QuickFurno Phase-15 blue/green.
#
# This prepares Docker release-control and the Nginx switch seam while keeping
# traffic on the existing PM2 :3000 runtime. It does NOT promote an image.
set -Eeuo pipefail
umask 077

EXPECTED_SOURCE_SHA="${1:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$HERE/../.." && pwd)"
CONTROL_ROOT="/srv/quickfurno/release-control"
ENV_FILE="/etc/quickfurno/production.env"
STATE_ROOT="/var/lib/quickfurno-phase15"
NGINX_SITE_ENTRY="/etc/nginx/sites-enabled/quickfurno"
NGINX_SITE=""
NGINX_INCLUDE="/etc/nginx/quickfurno/phase15-active-upstream.conf"
LIVE_LINK="/var/www/quickfurno-marketplace"

die(){ echo "QF_PHASE15_BOOTSTRAP_REFUSED: $1" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "must run as root on the approved QuickFurno host"
[[ "$EXPECTED_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "usage: bootstrap-production-host.sh <source-sha>"
[[ -x /usr/sbin/nginx ]] || die "nginx missing"
command -v docker >/dev/null 2>&1 || die "Docker must be installed before bootstrap"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 missing"
[[ -L "$LIVE_LINK" ]] || die "legacy production link missing"
if [[ -L "$NGINX_SITE_ENTRY" ]]; then
  NGINX_SITE="$(readlink -f "$NGINX_SITE_ENTRY")"
  [[ "$NGINX_SITE" == /etc/nginx/sites-available/* ]] || die "QuickFurno Nginx symlink target invalid"
elif [[ -f "$NGINX_SITE_ENTRY" ]]; then
  NGINX_SITE="$NGINX_SITE_ENTRY"
else
  die "QuickFurno Nginx site missing"
fi
[[ -f "$NGINX_SITE" && ! -L "$NGINX_SITE" ]] || die "QuickFurno Nginx site target invalid"
[[ "$(stat -c '%u' "$NGINX_SITE")" == "0" ]] || die "QuickFurno Nginx site must be root-owned"

for port in 3101 3102; do
  if ss -lnt | awk '{print $4}' | grep -Eq "[:.]$port$"; then
    die "Phase-15 slot port already occupied: $port"
  fi
done

LEGACY_ROOT="$(readlink -f "$LIVE_LINK")"
[[ "$LEGACY_ROOT" == /var/www/qf-prod-release-* ]] || die "unexpected legacy release target"
LEGACY_ENV="$LEGACY_ROOT/.env.local"
[[ -f "$LEGACY_ENV" && ! -L "$LEGACY_ENV" ]] || die "legacy production env file missing"
[[ "$(stat -c '%u' "$LEGACY_ENV")" == "0" ]] || die "legacy env must be root-owned"

# Prove the currently served runtime before changing any host control files.
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:3000/)" == "200" ]] ||
  die "legacy local web is not healthy"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://quickfurno.in/)" == "200" ]] ||
  die "public QuickFurno smoke failed"

BACKUP_ROOT="/var/lib/quickfurno-phase15-bootstrap"
install -d -o 0 -g 0 -m 0700 "$BACKUP_ROOT"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_ROOT/$STAMP"
install -d -o 0 -g 0 -m 0700 "$BACKUP"
install -o 0 -g 0 -m 0600 "$NGINX_SITE" "$BACKUP/nginx-site"

# Secret material is copied only locally on the server and is never printed.
install -d -o 0 -g 0 -m 0755 /etc/quickfurno /etc/quickfurno/secrets
install -o 0 -g 0 -m 0600 "$LEGACY_ENV" "$ENV_FILE"

# Install the minimum reviewed release-control closure instead of a writable repo.
install -d -o 0 -g 0 -m 0755   "$CONTROL_ROOT/ops/phase15"   "$CONTROL_ROOT/ops/container"   "$CONTROL_ROOT/scripts/scale"   "$CONTROL_ROOT/contracts"
install -o 0 -g 0 -m 0755 "$SOURCE_ROOT/ops/phase15/blue-green.sh" "$CONTROL_ROOT/ops/phase15/blue-green.sh"
install -o 0 -g 0 -m 0755 "$SOURCE_ROOT/ops/phase15/nginx-switch.sh" "$CONTROL_ROOT/ops/phase15/nginx-switch.sh"
install -o 0 -g 0 -m 0755 "$SOURCE_ROOT/ops/phase15/qf-phase15-release.wrapper" "$CONTROL_ROOT/ops/phase15/qf-phase15-release.wrapper"
install -o 0 -g 0 -m 0644 "$SOURCE_ROOT/ops/container/compose.production.yml" "$CONTROL_ROOT/ops/container/compose.production.yml"
install -o 0 -g 0 -m 0644 "$SOURCE_ROOT/scripts/scale/phase15-release.mjs" "$CONTROL_ROOT/scripts/scale/phase15-release.mjs"
install -o 0 -g 0 -m 0644 "$SOURCE_ROOT/contracts/qf-release-phase15-v1.schema.json" "$CONTROL_ROOT/contracts/qf-release-phase15-v1.schema.json"
printf '%s\n' "$EXPECTED_SOURCE_SHA" > "$CONTROL_ROOT/SOURCE_SHA"
chown 0:0 "$CONTROL_ROOT/SOURCE_SHA"
chmod 0444 "$CONTROL_ROOT/SOURCE_SHA"

# Fixed host wrapper supplies only non-secret paths and policy toggles.
TMP_WRAPPER="$(mktemp /tmp/qf-phase15-release.XXXXXX)"
cat >"$TMP_WRAPPER" <<'WRAPPER'
#!/usr/bin/env bash
set -Eeuo pipefail
export QF_ENV_FILE=/etc/quickfurno/production.env
export QF_PHASE15_PUBLIC_SMOKE_URL=https://quickfurno.in/
export QF_PHASE15_AAROHI_ENABLED=0
exec /srv/quickfurno/release-control/ops/phase15/qf-phase15-release.wrapper "$@"
WRAPPER
install -o 0 -g 0 -m 0755 "$TMP_WRAPPER" /usr/local/sbin/qf-phase15-release
rm -f "$TMP_WRAPPER"

install -d -o 0 -g 0 -m 0700 "$STATE_ROOT"
id qfdeploy >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/quickfurno/runner --shell /bin/bash qfdeploy

TMP_SUDO="$(mktemp /tmp/qf-phase15-sudoers.XXXXXX)"
cat >"$TMP_SUDO" <<'SUDO'
qfdeploy ALL=(root) NOPASSWD: /usr/local/sbin/qf-phase15-release stage *, /usr/local/sbin/qf-phase15-release promote, /usr/local/sbin/qf-phase15-release rollback, /usr/local/sbin/qf-phase15-release status
SUDO
chmod 0440 "$TMP_SUDO"
visudo -cf "$TMP_SUDO" >/dev/null
install -o 0 -g 0 -m 0440 "$TMP_SUDO" /etc/sudoers.d/qf-phase15-deployer
rm -f "$TMP_SUDO"

# Validate the container contract without pulling or starting a release.
QF_IMAGE_REF='ghcr.io/quickfurno-maker/quickfurno-marketplace@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' QF_RELEASE_SHA='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' QF_ENV_FILE="$ENV_FILE" docker compose -f "$CONTROL_ROOT/ops/container/compose.production.yml" config --quiet

# Introduce the switch seam while deliberately keeping traffic on legacy :3000.
install -d -o 0 -g 0 -m 0755 /etc/nginx/quickfurno
printf '%s\n' 'set $qf_phase15_upstream http://127.0.0.1:3000; # legacy-pm2 bootstrap' > "$NGINX_INCLUDE"
chown 0:0 "$NGINX_INCLUDE"
chmod 0644 "$NGINX_INCLUDE"

if ! grep -Fq 'phase15-active-upstream.conf' "$NGINX_SITE"; then
  python3 - "$NGINX_SITE" <<'PY'
import sys
path=sys.argv[1]
with open(path,encoding="utf-8") as fh:
    text=fh.read()
old="        proxy_pass http://127.0.0.1:3000;"
new="        include /etc/nginx/quickfurno/phase15-active-upstream.conf;\n        proxy_pass $qf_phase15_upstream;"
if text.count(old)!=1:
    raise SystemExit("expected exactly one legacy proxy_pass")
with open(path,"w",encoding="utf-8") as fh:
    fh.write(text.replace(old,new,1))
PY
fi

rollback_nginx(){
  install -o 0 -g 0 -m 0644 "$BACKUP/nginx-site" "$NGINX_SITE"
  /usr/sbin/nginx -t >/dev/null 2>&1 && /usr/sbin/nginx -s reload >/dev/null 2>&1 || true
}

if ! /usr/sbin/nginx -t; then
  rollback_nginx
  die "Nginx seam validation failed"
fi
/usr/sbin/nginx -s reload
if [[ "$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 https://quickfurno.in/)" != "200" ]]; then
  rollback_nginx
  die "public smoke failed after Nginx seam installation"
fi

[[ "$(stat -c '%a' "$ENV_FILE")" == "600" ]] || die "external env permissions invalid"
[[ "$(stat -c '%u' "$CONTROL_ROOT")" == "0" ]] || die "release-control not root-owned"
/usr/local/sbin/qf-phase15-release status >/dev/null

echo "QF_PHASE15_BOOTSTRAP_READY source=$EXPECTED_SOURCE_SHA backup=$BACKUP"
echo "TRAFFIC_UNCHANGED upstream=127.0.0.1:3000"
echo "NEXT: register the repository-scoped qf-phase15-deployer runner, then re-run the verified exact-digest promotion."
