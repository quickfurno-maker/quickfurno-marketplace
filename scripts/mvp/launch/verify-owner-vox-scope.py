#!/usr/bin/env python3
"""Fail-closed source inventory for the isolated VOX Owner preview candidate.
Does not authorize merge, signing, deployment or runtime feature activation.
"""
from pathlib import Path
import argparse
import hashlib
import json

MANIFEST = Path("docs/launch/f0-owner-vox-file-manifest.json")
REQUIRED_ROUTES = {
    "app/api/health/route.ts",
    "app/api/auth/sign-in/route.ts",
    "app/api/auth/mfa/route.ts",
    "app/api/owner/vendor-verification/queue/route.ts",
    "app/api/owner/vendor-verification/case/route.ts",
    "app/api/owner/vendor-verification/decision/route.ts",
    "app/owner/vendors/verification/page.tsx",
    "app/operations/page.tsx",
    "app/login/page.tsx",
    "app/mfa/page.tsx",
    "app/vendor360/page.tsx",
}
FORBIDDEN_APP_SEGMENTS = {
    "team", "finance", "staff-reviews", "studio", "acquisition",
    "intelligence", "preview", "service-desk", "approvals",
    "staff-time", "tl-assignments", "team-chat", "team-presence",
}
ROUTE_SUFFIXES = {"page.tsx", "page.ts", "route.ts", "route.tsx"}
SKIP_DIRS = {".next", "node_modules", ".git"}

def errors_for(repo: Path):
    repo = repo.resolve()
    root = repo / "apps/vox-web"
    document = json.loads((repo / MANIFEST).read_text(encoding="utf-8"))
    failures = []
    if document.get("policy") != "quickfurno.f0.owner-vox-minimal.v1":
        failures.append("unexpected_policy")
    if document.get("production_authorized") is not False:
        failures.append("no_production_authorization")
    if document.get("unreviewed_staff_enabled") is not False:
        failures.append("staff_must_be_disabled")
    sha = document.get("source_sha", "")
    if not isinstance(sha, str) or len(sha) != 40 or any(c not in "0123456789abcdef" for c in sha):
        failures.append("untrusted_source_sha")
    entries = document.get("files", [])
    if not isinstance(entries, list):
        return ["malformed_file_inventory"]
    expected = {}
    for entry in entries:
        path = entry.get("path", "")
        digest = entry.get("sha256", "")
        if not isinstance(path, str) or not path.startswith("apps/vox-web/"):
            failures.append("foreign_file"); continue
        rel = Path(path)
        if rel.is_absolute() or ".." in rel.parts or path in expected:
            failures.append("invalid_or_duplicate_path"); continue
        expected[path] = digest
    if len(expected) != document.get("total_files"):
        failures.append("file_count_mismatch")
    actual = set()
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix == ".tsbuildinfo" or any(part in SKIP_DIRS for part in p.parts):
            continue
        path = p.relative_to(repo).as_posix()
        actual.add(path)
        if path not in expected:
            failures.append("unlisted_file:" + path)
        else:
            blob = p.read_bytes()
            # Python text generation / Windows checkout may translate only the
            # explicitly new landing redirect; verify its canonical LF form.
            if path == "apps/vox-web/app/page.tsx":
                blob = blob.replace(b"\r\n", b"\n")
            if hashlib.sha256(blob).hexdigest() != expected[path]:
                failures.append("modified_file:" + path)
        rel = p.relative_to(root)
        if rel.parts[0] == "app" and any(part in FORBIDDEN_APP_SEGMENTS for part in rel.parts[1:-1]):
            failures.append("forbidden_app_route:" + path)
        if rel.parts[0] == "app" and rel.name in ROUTE_SUFFIXES:
            allowed = set(document.get("allowed_routes", [])) | {"app/page.tsx"}
            if rel.as_posix() not in allowed:
                failures.append("unreviewed_runtime_route:" + path)
    for name in expected.keys() - actual:
        failures.append("missing_file:" + name)
    if not REQUIRED_ROUTES.issubset(set(document.get("allowed_routes", []))):
        failures.append("required_owner_routes_missing")
    if not {"apps/vox-web/app/page.tsx",
            "apps/vox-web/app/owner/vendors/verification/page.tsx"}.issubset(actual):
        failures.append("missing_owner_entrypoints")
    return sorted(set(failures))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("."))
    args = parser.parse_args()
    failures = errors_for(args.repo)
    print(json.dumps({"policy": "quickfurno.f0.owner-vox-minimal.v1",
                      "valid": not failures,
                      "failures": failures,
                      "deployment_authorized": False}, indent=2))
    raise SystemExit(1 if failures else 0)
