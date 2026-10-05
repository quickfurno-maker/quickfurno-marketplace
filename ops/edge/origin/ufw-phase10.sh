#!/usr/bin/env bash
set -euo pipefail

# Run as root on the dedicated QuickFurno origin only after console/SSH rollback
# access is proven. It never opens application/database/cache ports.
if [[ ${EUID} -ne 0 ]]; then
  echo "FATAL: run as root" >&2
  exit 1
fi

command -v ufw >/dev/null || { echo "FATAL: ufw is not installed" >&2; exit 1; }

# Preserve administrative access before changing the default ingress posture.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw default deny incoming
ufw default allow outgoing
ufw --force enable

ufw status verbose
