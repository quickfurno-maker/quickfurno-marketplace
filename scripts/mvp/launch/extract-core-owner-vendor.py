#!/usr/bin/env python3
"""Reproduce a bounded Marketplace Core + vendor integration cut from a pinned SHA.

Source only: no database access, provider calls, deployment or activation.
Only copies verified changed dependencies reachable from listed endpoints.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess

ROOTS = (
    "app/api/vendor/onboarding/request-otp/route.ts",
    "app/api/vendor/onboarding/complete/route.ts",
    "app/api/vendor/private-evidence/route.ts",
    "app/api/vox/v1/owner-vendor-signup-status/route.ts",
    "app/api/vox/v1/owner-vendor-verification-readiness/route.ts",
    "app/api/vox/v1/owner-vendor-verification-queue/route.ts",
    "app/api/vox/v1/owner-vendor-verification-case/route.ts",
    "app/api/vox/v1/owner-workspaces/route.ts",
)
SQL = (
    "20261104090000_vendor_registration_consent_receipt.sql",
    "20261104140000_vendor_private_otp_and_verification_foundation.sql",
    "20261104153000_vendor_atomic_pending_registration.sql",
    "20261104160000_vendor_owner_review_assignment_gate.sql",
    "20261104163000_vendor_private_document_intake.sql",
    "20261104170000_vox_owner_vendor_review_queue.sql",
    "20261104173000_vendor_private_scan_quarantine.sql",
)
EXT = (".ts", ".tsx", ".mjs", ".js", ".json", ".css", ".d.mts")
IMPORT = re.compile(
    r"""(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\(|\bimport\s+)['"]([^'"]+)['"]""")
ALLOWED_EXT = (".ts", ".tsx", ".mjs", ".js", ".json", ".css", ".mts")
MAX_CHANGED = 140
# These baseline implementations already export the needed Owner Auth APIs;
# the candidate delta adds unrelated Staff and EOD functions only.
BASELINE_ONLY = {"lib/supabase.ts", "services/vox/verifiedStaffBearer.ts"}

def commit(repo: Path) -> str:
    return subprocess.check_output(
        ["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()

def resolve(spec: str, current: Path, src: Path) -> Path | None:
    if spec.startswith("@/"):
        prefix = Path(spec[2:])
    elif spec.startswith(("./", "../")):
        prefix = current.parent / spec
    else:
        return None
    for candidate in (
        prefix, *(Path(str(prefix) + ext) for ext in EXT),
        *(prefix / ("index" + ext) for ext in EXT)):
        path = (src / candidate).resolve()
        if not path.is_relative_to(src.resolve()):
            raise ValueError(f"Source import escapes root: {current}: {spec}")
        if path.is_file():
            return path.relative_to(src.resolve())
    raise FileNotFoundError(f"Missing source import: {current}: {spec}")

def dependencies(name: Path, src: Path) -> list[Path]:
    file = src / name
    if file.suffix not in (".ts", ".tsx", ".mjs", ".js", ".css"):
        return []
    if file.name.endswith((".d.ts", ".d.mts")):
        return []
    raw = file.read_text(encoding="utf-8")
    imports = []
    for spec in IMPORT.findall(raw):
        resolved = resolve(spec, name, src)
        if resolved is not None:
            imports.append(resolved)
    return imports

def generate(src: Path, dst: Path) -> dict:
    src, dst = src.resolve(), dst.resolve()
    if src == dst:
        raise ValueError("Source and destination must be separate clean worktrees")
    source_sha, base_sha = commit(src), commit(dst)
    queue = list(map(Path, ROOTS))
    selected = set()
    dep_edges = {}
    while queue:
        rel = queue.pop()
        if rel in selected:
            continue
        path = src / rel
        if not path.is_file():
            raise FileNotFoundError(str(path))
        if rel.parts[:2] == ("app", "api") and rel.as_posix() not in ROOTS:
            # Never transitively add an endpoint with side effects.
            raise ValueError(f"Unexpected additional API endpoint: {rel}")
        if rel.suffix not in ALLOWED_EXT:
            raise ValueError(f"Unsupported source extension: {rel}")
        selected.add(rel)
        deps = dependencies(rel, src)
        dep_edges[rel.as_posix()] = [x.as_posix() for x in deps]
        queue.extend(deps)
        if rel.suffix == ".mjs":
            types = Path(str(rel)[:-4] + ".d.mts")
            if (src / types).is_file():
                queue.append(types)

    rows = []
    for rel in sorted(selected):
        path = src / rel
        target = dst / rel
        if rel.as_posix() in BASELINE_ONLY:
            if not target.is_file():
                raise FileNotFoundError(f"Required protected baseline dependency missing: {rel}")
            continue
        code = path.read_bytes()
        if target.is_file() and target.read_bytes() == code:
            continue
        # Prevent hidden changes to an already-reviewed Owner-only VOX host.
        if rel.parts[:2] == ("apps", "vox-web"):
            raise ValueError(f"Owner VOX overlap: {rel}")
        rows.append({"path": rel.as_posix(), "sha256": hashlib.sha256(code).hexdigest(),
                     "new": not target.is_file()})
    if len(rows) > MAX_CHANGED:
        raise ValueError(f"Too many changed Core files ({len(rows)} > {MAX_CHANGED})")

    for sql in SQL:
        rel = Path("supabase/migrations") / sql
        if not (src / rel).is_file():
            raise FileNotFoundError(f"Missing pinned vendor migration: {rel}")
        if (dst / rel).exists():
            raise RuntimeError(f"SQL already exists in base; require reconciliation: {rel}")
        blob = (src / rel).read_bytes()
        rows.append({"path": rel.as_posix(),
                     "sha256": hashlib.sha256(blob).hexdigest(),
                     "new": True, "migration": True})
    if len(rows) != len({x["path"] for x in rows}):
        raise ValueError("Duplicate manifest paths")
    # Only after completing the entire import/allowlist review do we copy.
    for row in rows:
        rel = Path(row["path"])
        dest = dst / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes((src / rel).read_bytes())
    manifest = {
        "policy": "quickfurno.f1.core-vendor-owner-no-deploy.v1",
        "source_sha": source_sha,
        "base_sha": base_sha,
        "entrypoints": list(ROOTS),
        "sql_order": [f"supabase/migrations/{name}" for name in SQL],
        "file_count": len(rows),
        "release_authorized": False,
        "managed_migrations_applied_by_this_batch": False,
        "public_vendor_signup_enabled": False,
        "staff_activation_authorized": False,
        "selected_dependency_edges": dep_edges,
        "files": sorted(rows, key=lambda r: r["path"]),
    }
    output = dst / "docs/launch/f1-core-owner-vendor-manifest.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    return manifest

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--target", required=True, type=Path)
    args = parser.parse_args()
    data = generate(args.source, args.target)
    print(json.dumps({"source_sha": data["source_sha"],
                      "changed_files": data["file_count"],
                      "owner_endpoints": len(data["entrypoints"]),
                      "vendor_sql": len(data["sql_order"]),
                      "release": "HOLD"}))
