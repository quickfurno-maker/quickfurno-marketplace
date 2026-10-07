#!/usr/bin/env python3
import json
import os
import time
import urllib.request

OTLP_ENDPOINT = "http://127.0.0.1:4318/v1/metrics"
WEB_HEALTH_URL = "http://127.0.0.1:3000/"
AUTOMATION_WORKER_MARKER = "/var/www/quickfurno-marketplace/dist/automation-worker.mjs"

# PM2/Node rewrites the process title in the current production topology and the
# resulting argv is truncated at this stable, unique prefix. The full on-disk
# script remains dist/conversation-transport-worker.mjs.
CONVERSATION_TRANSPORT_PROCESS_PREFIX = (
    "/var/www/quickfurno-marketplace/dist/conversation-transpor"
)

def web_ok():
    try:
        with urllib.request.urlopen(WEB_HEALTH_URL, timeout=3) as response:
            return 200 <= response.status < 500
    except Exception:
        return False

def process_ok(marker):
    marker_bytes = marker.encode("utf-8")
    try:
        entries = os.scandir("/proc")
    except OSError:
        return False

    with entries:
        for entry in entries:
            if not entry.name.isdigit():
                continue
            try:
                with open(f"/proc/{entry.name}/cmdline", "rb") as handle:
                    if marker_bytes in handle.read():
                        return True
            except (FileNotFoundError, PermissionError, ProcessLookupError, OSError):
                continue
    return False

def heartbeat_payload(service_name, now_s, now_ns):
    return {
        "resourceMetrics": [{
            "resource": {"attributes": [
                {"key": "service.name", "value": {"stringValue": service_name}},
                {"key": "deployment.environment.name", "value": {"stringValue": "production"}},
                {"key": "qf.telemetry.source", "value": {"stringValue": "pm2-health-bridge"}},
            ]},
            "scopeMetrics": [{
                "scope": {"name": "quickfurno.phase14.health-bridge", "version": "2"},
                "metrics": [{
                    "name": "qf.telemetry.heartbeat.unixtime",
                    "gauge": {"dataPoints": [{
                        "attributes": [{"key": "stage", "value": {"stringValue": "heartbeat"}}],
                        "asDouble": float(now_s),
                        "timeUnixNano": str(now_ns),
                    }]},
                }],
            }],
        }],
    }

targets = (
    ("quickfurno.web", web_ok),
    ("quickfurno.automation-worker", lambda: process_ok(AUTOMATION_WORKER_MARKER)),
    (
        "quickfurno.conversation-transport",
        lambda: process_ok(CONVERSATION_TRANSPORT_PROCESS_PREFIX),
    ),
)

emitted = []
for service, healthy in targets:
    if not healthy():
        continue
    now_s = int(time.time())
    payload = heartbeat_payload(service, now_s, time.time_ns())
    request = urllib.request.Request(
        OTLP_ENDPOINT,
        data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 200:
            raise RuntimeError(f"otlp_refused:{service}:{response.status}")
    emitted.append(service)

print(json.dumps({
    "event": "qf_health_bridge_tick",
    "services": emitted,
    "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
}, separators=(",", ":")))
