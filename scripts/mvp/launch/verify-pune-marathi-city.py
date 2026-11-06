#!/usr/bin/env python3
"""Tightly scoped Google city-script equivalence patch, not a live release."""
import argparse, hashlib, json, subprocess
from pathlib import Path

BASE = "decf3ddcad49e702cad11b756d8910530938c8bb"
POLICY = "quickfurno.f4.google-pune-marathi-label-no-deploy.v1"
CODE = {
 "lib/google-maps/normalizePlace.ts": "aa88b498ab18c0249cb5325ba74ad1d237acce0a1e801508384b9033cdcd547f",
 "scripts/mvp/location/validate-google-marathi-city.test.mjs": "bf7851dd9318ef1e49c23e6aa21f9992b2a284fc72e5125f997275e333d0a727",
}
META = {
 ".github/workflows/qf-f4-pune-marathi-city.yml",
 "docs/launch/F4-MARATHI-PUNE-CITY-MATCHING-20261106.md",
 "docs/launch/f4-pune-marathi-city-manifest.json",
 "scripts/mvp/launch/verify-pune-marathi-city.py",
 "scripts/mvp/launch/test_pune_marathi_scope.py",
}
MANIFEST = "docs/launch/f4-pune-marathi-city-manifest.json"
FLAGS = ("release_authorized", "production_deployed", "staging_deployed",
         "geofence_disabled", "city_activation_changed", "managed_db_updated")

def digest(data):
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()

def failures(repo, changed=None):
    repo = Path(repo).resolve()
    try:
        manifest = json.loads((repo/MANIFEST).read_text(encoding="utf8"))
    except (OSError, ValueError):
        return ["missing_manifest"]
    bad = []
    if manifest.get("policy") != POLICY or manifest.get("base_sha") != BASE:
        bad.append("untrusted_base")
    for flag in FLAGS:
        if manifest.get(flag) is not False:
            bad.append("unauthorized_" + flag)
    rows = manifest.get("files", [])
    if not isinstance(rows, list):
        return bad + ["bad_source_rows"]
    seen = set()
    for item in rows:
        if not isinstance(item,dict) or not isinstance(item.get("path"),str):
            bad.append("invalid_source_row"); continue
        name = item["path"]
        if name in seen or name not in CODE:
            bad.append("unexpected_path:" + name)
            continue
        seen.add(name)
        if item.get("sha256") != CODE[name]:
            bad.append("untrusted_pin:" + name)
        path = repo/name
        if not path.is_file() or digest(path.read_bytes()) != CODE[name]:
            bad.append("source_modified:" + name)
    if seen != set(CODE):
        bad.append("missing_source")
    try:
        normalizer = (repo/"lib/google-maps/normalizePlace.ts").read_text(encoding="utf8")
        provider = (repo/"components/location/ProjectLocationProvider.tsx").read_text(encoding="utf8")
        if 'EXACT_PUNE_MARATHI_TOKEN' not in normalizer or "पुणे" not in normalizer:
            bad.append("canonical_alias_missing")
        if "isPlaceCompatibleWithSelectedCity" not in provider or "if (!place.placeId" not in provider:
            bad.append("geofence_or_place_identity_bypassed")
    except OSError:
        bad.append("required_production_dependency_missing")
    if changed is not None:
        bad.extend("unreviewed_diff:" + x for x in changed - (set(CODE) | META))
        bad.extend("expected_change_not_in_diff:" + x for x in set(CODE) - changed)
    return sorted(set(bad))

def git_changed(repo):
    raw = subprocess.check_output(
        ["git","-C",str(repo),"diff","--name-only",BASE+"...HEAD"],text=True)
    return set(raw.splitlines())

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--repo",type=Path,default=Path("."))
    p.add_argument("--exact-git-diff",action="store_true")
    args=p.parse_args()
    bad=failures(args.repo,git_changed(args.repo) if args.exact_git_diff else None)
    print(json.dumps({"policy":POLICY,"valid":not bad,
        "release_authorized":False,"failures":bad},indent=2))
    raise SystemExit(bool(bad))
