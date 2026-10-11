import importlib.util
import io
import json
import pathlib
from types import SimpleNamespace
import unittest
from unittest import mock

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "qf-otel-heartbeat-bridge.py"
spec = importlib.util.spec_from_file_location("qf_heartbeat_bridge", SCRIPT)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class Response:
    def __init__(self, status=200):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class DirEntries:
    def __init__(self, names):
        self.names = names

    def __enter__(self):
        return self

    def __iter__(self):
        return iter(SimpleNamespace(name=name) for name in self.names)

    def __exit__(self, *_):
        return False


class BridgeTests(unittest.TestCase):
    def test_web_health_rejects_redirect_and_404(self):
        for status, expected in [(200, True), (204, True), (302, False), (404, False), (503, False)]:
            opener = mock.Mock()
            if status == 302:
                opener.open.side_effect = bridge.urllib.error.HTTPError("http://localhost/", status, "redirect", {}, None)
            else:
                opener.open.return_value = Response(status)
            with mock.patch.object(bridge.urllib.request, "build_opener", return_value=opener):
                self.assertEqual(bridge.web_ok(), expected, status)
                (url,), kwargs = opener.open.call_args
                self.assertEqual(url, "http://127.0.0.1:3000/")
                self.assertEqual(kwargs["timeout"], 3)
        self.assertEqual(bridge.OTLP_ENDPOINT, "http://127.0.0.1:4318/v1/metrics")

    def test_web_network_error_fails_closed(self):
        opener = mock.Mock()
        opener.open.side_effect = bridge.urllib.error.URLError("refused")
        with mock.patch.object(bridge.urllib.request, "build_opener", return_value=opener):
            self.assertFalse(bridge.web_ok())

    def test_proc_matches_only_exact_rewritten_pm2_title(self):
        marker = bridge.AUTOMATION_WORKER_MARKER
        original = ("node " + marker).encode("ascii")
        for payload, expected in [
            (original + b"\x00", True),
            (b"python\x00" + original + b"\x00", False),
            (original + b"-unrelated\x00", False),
            (b"bash -c echo " + original + b"\x00", False),
            (b"\x00", False),
        ]:
            with mock.patch.object(bridge.os, "scandir", return_value=DirEntries(["1"])), mock.patch(
                "builtins.open", return_value=io.BytesIO(payload)
            ):
                self.assertEqual(bridge.process_ok(marker), expected, payload)

    def test_proc_read_refusal_never_claims_healthy(self):
        with mock.patch.object(bridge.os, "scandir", return_value=DirEntries(["4"])), mock.patch(
            "builtins.open", side_effect=PermissionError("denied")
        ):
            self.assertFalse(bridge.process_ok(bridge.AUTOMATION_WORKER_MARKER))

    def test_only_healthy_services_emit_bounded_labels(self):
        requests = []
        def collect(request, timeout):
            self.assertEqual(request.full_url, bridge.OTLP_ENDPOINT)
            self.assertEqual(request.get_method(), "POST")
            self.assertEqual(timeout, 5)
            requests.append(json.loads(request.data))
            return Response(200)
        with mock.patch.object(bridge, "web_ok", return_value=True), mock.patch.object(
            bridge, "process_ok", side_effect=[False, True]
        ), mock.patch.object(bridge.urllib.request, "urlopen", side_effect=collect):
            result = bridge.tick()
        self.assertEqual(result["services"], ["quickfurno.web", "quickfurno.conversation-transport"])
        self.assertEqual(len(requests), 2)
        for payload in requests:
            attrs = payload["resourceMetrics"][0]["resource"]["attributes"]
            self.assertEqual({x["key"] for x in attrs}, {
                "service.name", "deployment.environment.name", "qf.telemetry.source"
            })
            self.assertEqual(payload["resourceMetrics"][0]["scopeMetrics"][0]["metrics"][0]["name"],
                "qf.telemetry.heartbeat.unixtime")
            self.assertNotIn("phone", json.dumps(payload).lower())

    def test_collector_refusal_is_not_success(self):
        with mock.patch.object(bridge, "web_ok", return_value=True), mock.patch.object(
            bridge.urllib.request, "urlopen", return_value=Response(503)
        ):
            with self.assertRaisesRegex(RuntimeError, "otlp_refused:quickfurno.web:503"):
                bridge.tick()

    def test_systemd_has_no_execution_grants(self):
        folder = SCRIPT.parent
        service = (folder / "qf-otel-heartbeat-bridge.service").read_text()
        timer = (folder / "qf-otel-heartbeat-bridge.timer").read_text()
        installer = (folder / "install-qf-otel-heartbeat-bridge.sh").read_text()
        source = SCRIPT.read_text()
        for setting in ("DynamicUser=yes", "NoNewPrivileges=yes", "ProtectSystem=strict", "ProtectHome=yes"):
            self.assertIn(setting, service)
        self.assertIn("OnUnitActiveSec=15s", timer)
        self.assertIn("qf-otel-agent.service is not active", installer)
        for forbidden in ("subprocess", "os.system(", "docker.sock", "AGNI_ACTION"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
