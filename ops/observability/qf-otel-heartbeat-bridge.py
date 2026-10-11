#!/usr/bin/env python3
"""Temporary read-only PM2 liveness bridge; zero Core or execution authority."""
import json
import os
import time
import urllib.error
import urllib.request

OTLP_ENDPOINT = "http://127.0.0.1:4318/v1/metrics"
WEB_HEALTH_URL = "http://127.0.0.1:3000/"
AUTOMATION_WORKER_MARKER = "/var/www/quickfurno-marketplace/dist/automation-worker.mjs"
# Live PM2 title truncation verified on production 2026-10-11.
CONVERSATION_TRANSPORT_PROCESS_PREFIX = (
    "/var/www/quickfurno-marketplace/dist/conversation-transpor"
)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def web_ok():
    # Refuse untrusted redirects/proxies and all HTTP failure codes.
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
        with opener.open(WEB_HEALTH_URL, timeout=3) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return False


def process_ok(marker):
    expected = ("node " + marker).encode("utf-8")
    try:
        entries = os.scandir("/proc")
    except OSError:
        return False
    with entries:
        for entry in entries:
            if not entry.name.isdigit():
                continue
            try:
                # PM2 rewrites argv[0]; compare exact truncated title, not
                # arbitrary process arguments that could produce false positives.
                with open(f"/proc/{entry.name}/cmdline", "rb") as handle:
                    title = handle.read(256).split(b"\x00", 1)[0]
                if title == expected:
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
                "scope": {"name": "quickfurno.phase14.health-bridge", "version": "3"},
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


def tick():
    targets = (
        ("quickfurno.web", web_ok),
        ("quickfurno.automation-worker", lambda: process_ok(AUTOMATION_WORKER_MARKER)),
        ("quickfurno.conversation-transport", lambda: process_ok(CONVERSATION_TRANSPORT_PROCESS_PREFIX)),
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
    return {
        "event": "qf_health_bridge_tick",
        "services": emitted,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


if __name__ == "__main__":
    print(json.dumps(tick(), separators=(",", ":")))
