#!/usr/bin/env bash
set -Eeuo pipefail

[[ "$(id -u)" -eq 0 ]] || { echo "FATAL: root required" >&2; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT=/usr/local/libexec/qf-otel-heartbeat-bridge.py
SERVICE=/etc/systemd/system/qf-otel-heartbeat-bridge.service
TIMER=/etc/systemd/system/qf-otel-heartbeat-bridge.timer

[[ -f "$HERE/qf-otel-heartbeat-bridge.py" && ! -L "$HERE/qf-otel-heartbeat-bridge.py" ]] || {
  echo "FATAL: heartbeat bridge source missing" >&2
  exit 1
}
systemctl is-active --quiet qf-otel-agent.service || {
  echo "FATAL: qf-otel-agent.service is not active" >&2
  exit 1
}

install -d -o root -g root -m 0755 /usr/local/libexec
install -o root -g root -m 0755 "$HERE/qf-otel-heartbeat-bridge.py" "$SCRIPT"
install -o root -g root -m 0644 "$HERE/qf-otel-heartbeat-bridge.service" "$SERVICE"
install -o root -g root -m 0644 "$HERE/qf-otel-heartbeat-bridge.timer" "$TIMER"

/usr/bin/python3 -m py_compile "$SCRIPT"
systemctl daemon-reload
systemctl enable --now qf-otel-heartbeat-bridge.timer >/dev/null
systemctl start qf-otel-heartbeat-bridge.service

systemctl is-enabled --quiet qf-otel-heartbeat-bridge.timer || {
  echo "FATAL: heartbeat timer not enabled" >&2
  exit 1
}
systemctl is-active --quiet qf-otel-heartbeat-bridge.timer || {
  echo "FATAL: heartbeat timer not active" >&2
  exit 1
}
systemctl show qf-otel-heartbeat-bridge.service -p DynamicUser --value | grep -qx yes || {
  echo "FATAL: heartbeat bridge must use DynamicUser" >&2
  exit 1
}
systemctl show qf-otel-heartbeat-bridge.service -p NoNewPrivileges --value | grep -qx yes || {
  echo "FATAL: heartbeat bridge must use NoNewPrivileges" >&2
  exit 1
}

echo QF_OTEL_HEARTBEAT_BRIDGE_INSTALLED
