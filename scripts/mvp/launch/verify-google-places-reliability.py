#!/usr/bin/env python3
"""Bounded Google Places SDK bootstrapping source audit; no provider certification."""
from pathlib import Path
import argparse, hashlib, json, subprocess

BASE = "8b228beebab2831041265098aaba0c884f912af4"
DONOR = "f7ffbc1dbf1f9165c7818d2cfb767be33e238c73"
POLICY = "quickfurno.f3.places-timeout-no-deploy.v1"
FILES = {
 "lib/google-maps/loadGoogleMaps.ts": "16d113f12315ce4b6cf1b1dc509b9518116b442a9402d5d33a5339d1cd78d90c",
 "scripts/mvp/location/validate-google-places-bounded-import.test.mjs": "4d99e689e69bda47aaf073803025b74849f8d4768bec2b687dea9589328c8675",
 "scripts/mvp/location/validate-google-places-singleflight.test.mjs": "89481797125531783d34f27c48da9cca25afb4be628c5e7af236fe19c7886005",
 "scripts/mvp/location/validate-google-places-timeout.test.mjs": "9a7ec5be4580f399b0823e5bfff76be58abc895023d1a7be76872351463db8cf",
}
REVIEW = {
 ".github/workflows/qf-f3-google-places-reliability.yml",
 "docs/launch/f3-google-places-source-manifest.json",
 "docs/launch/F3-GOOGLE-PLACES-BOUNDED-LOADER-20261106.md",
 "scripts/mvp/launch/verify-google-places-reliability.py",
 "scripts/mvp/launch/test_google_places_reliability_scope.py",
}
MANIFEST = Path("docs/launch/f3-google-places-source-manifest.json")

def sha(b: bytes) -> str:
    return hashlib.sha256(b.replace(b"\r\n", b"\n")).hexdigest()

def failures(repo: Path, diff: set[str] | None = None):
    repo = repo.resolve()
    bad = []
    try:
        data = json.loads((repo / MANIFEST).read_text(encoding="utf8"))
    except (OSError, ValueError):
        return ["manifest_missing"]
    if data.get("policy") != POLICY or data.get("donor_sha") != DONOR or data.get("base_sha") != BASE:
        bad.append("source_pin_invalid")
    for key in ("release_authorized", "google_billing_certified", "google_places_live_certified",
                "vendor_geofence_bypass_authorized", "managed_env_updated"):
        if data.get(key) is not False:
            bad.append("unsafe_certification:" + key)
    rows = data.get("files", [])
    if not isinstance(rows, list):
        return bad + ["files_invalid"]
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("path"), str):
            bad.append("file_record_invalid"); continue
        p = row["path"]
        if Path(p).is_absolute() or ".." in Path(p).parts or p in seen:
            bad.append("invalid_file_path")
            continue
        seen.add(p)
        if p not in FILES or row.get("sha256") != FILES.get(p):
            bad.append("not_pinned:" + p)
        file = repo / p
        if not file.is_file() or sha(file.read_bytes()) != FILES.get(p):
            bad.append("source_tampered:" + p)
    if seen != set(FILES):
        bad.append("source_inventory_incomplete")
    try:
        src = (repo / "lib/google-maps/loadGoogleMaps.ts").read_text(encoding="utf8")
        for value in ("PLACES_BOOTSTRAP_TIMEOUT_MS = 8000", "RUNTIME_KEY_TIMEOUT_MS = 2500",
                      "AbortSignal.timeout(RUNTIME_KEY_TIMEOUT_MS)", "boundedPlacesImport",
                      "Promise.race", "window.__qfGooglePlacesPromise",
                      "document.getElementById(SCRIPT_ID)?.remove()",
                      "cacheRecoverablePlacesPromise"):
            if value not in src:
                bad.append("bounded_bootstrap_contract_missing:" + value)
        if src.index("if (window.__qfGooglePlacesPromise) return window.__qfGooglePlacesPromise;") >            src.index('if (typeof window.google?.maps?.importLibrary === "function")'):
            bad.append("singleflight_check_after_import")
    except (OSError, ValueError):
        bad.append("bootstrap_loader_untrusted")
    if diff is not None:
        for p in diff - (set(FILES) | REVIEW):
            bad.append("unlisted_release_diff:" + p)
        for p in set(FILES) - diff:
            bad.append("changed_source_missing_from_diff:" + p)
    return sorted(set(bad))

def exact_diff(repo: Path):
    raw = subprocess.check_output(
        ["git", "-C", str(repo), "diff", "--name-only", BASE + "...HEAD"], text=True)
    return set(raw.splitlines())

if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("--repo", type=Path, default=Path("."))
    cli.add_argument("--exact-git-diff", action="store_true")
    opts = cli.parse_args()
    bad = failures(opts.repo, exact_diff(opts.repo) if opts.exact_git_diff else None)
    print(json.dumps({"policy": POLICY, "valid": not bad, "certified_live": False,
                      "failures": bad}, indent=2))
    raise SystemExit(1 if bad else 0)
