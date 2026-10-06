#!/usr/bin/env bash
# Atomically switches the QuickFurno Phase-15 Nginx upstream include.
set -Eeuo pipefail
umask 022

SLOT="${1:-}"
PORT="${2:-}"
SOURCE_SHA="${3:-}"
TARGET="${QF_PHASE15_NGINX_UPSTREAM_FILE:-/etc/nginx/quickfurno/phase15-active-upstream.conf}"
NGINX="${QF_PHASE15_NGINX_BIN:-/usr/sbin/nginx}"

die(){ echo "PHASE15_NGINX_REFUSED: $1" >&2; exit 1; }
[[ "$SLOT" == "blue" || "$SLOT" == "green" ]] || die "slot must be blue or green"
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || die "invalid port"
[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || die "invalid source sha"
[[ -x "$NGINX" ]] || die "nginx binary not executable: $NGINX"

DIR="$(dirname "$TARGET")"
[[ ! -L "$DIR" ]] || die "nginx include directory must not be a symlink"
install -d -o 0 -g 0 -m 0755 "$DIR"
[[ "$(stat -c '%u' "$DIR")" == "0" ]] || die "nginx include directory must be root-owned"

TMP="$(mktemp "$DIR/.phase15-upstream.XXXXXX")"
BACKUP="$(mktemp "$DIR/.phase15-backup.XXXXXX")"
cleanup(){ rm -f "$TMP" "$BACKUP"; }
trap cleanup EXIT

if [[ -f "$TARGET" ]]; then
  cp -a "$TARGET" "$BACKUP"
else
  : > "$BACKUP"
fi

printf 'set $qf_phase15_upstream http://127.0.0.1:%s; # %s %s\n' "$PORT" "$SLOT" "$SOURCE_SHA" > "$TMP"
chown 0:0 "$TMP"
chmod 0644 "$TMP"
mv -f "$TMP" "$TARGET"

restore(){
  if [[ -s "$BACKUP" ]]; then
    cp -a "$BACKUP" "$TARGET"
  else
    rm -f "$TARGET"
  fi
}

if ! "$NGINX" -t; then
  restore
  "$NGINX" -t >/dev/null 2>&1 || true
  die "nginx configuration test failed; previous upstream restored"
fi

if ! "$NGINX" -s reload; then
  restore
  "$NGINX" -t >/dev/null 2>&1 && "$NGINX" -s reload >/dev/null 2>&1 || true
  die "nginx reload failed; previous upstream restored"
fi

echo "PHASE15_NGINX_SWITCHED slot=$SLOT port=$PORT source=$SOURCE_SHA"
