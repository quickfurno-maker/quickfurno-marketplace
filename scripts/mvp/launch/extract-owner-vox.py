#!/usr/bin/env python3
"""Generate an isolated, reviewable VOX Owner-only file set from a pinned source.
No deployment, network, secrets, production writes, or feature activation.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
import subprocess
from owner_vox_overlays import restrict_owner_surface

CONFIG = (
    ".dockerignore", ".env.example", "Dockerfile", "next-env.d.ts",
    "next.config.ts", "package.json", "package-lock.json",
    "postcss.config.mjs", "tsconfig.json",
)
ROUTES = (
    "app/layout.tsx", "app/operations/page.tsx",
    "app/owner/vendors/verification/page.tsx",
    "app/vendor360/page.tsx",
    "app/login/page.tsx", "app/mfa/page.tsx", "app/mfa/enroll/page.tsx",
    "app/password/recover/page.tsx", "app/password/reset/page.tsx",
    "app/auth/callback/route.ts",
    "app/api/health/route.ts", "app/api/overview/route.ts",
    "app/api/vendor360/route.ts",
    "app/api/auth/sign-in/route.ts", "app/api/auth/sign-out/route.ts",
    "app/api/auth/mfa/route.ts", "app/api/auth/mfa/enroll/route.ts",
    "app/api/auth/mfa/confirm/route.ts",
    "app/api/auth/recovery/request/route.ts",
    "app/api/auth/recovery/complete/route.ts",
    "app/api/owner/vendor-verification/queue/route.ts",
    "app/api/owner/vendor-verification/case/route.ts",
    "app/api/owner/vendor-verification/decision/route.ts",
)
ROOT = Path("apps/vox-web")
RELATIVE_IMPORT = re.compile(r'(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["\'](\.{1,2}/[^"\']+)["\']')
EXT = (".ts", ".tsx", ".mjs", ".js", ".json", ".css", ".d.mts")
IGNORE_EXTERNAL = {"server-only", "client-only"}

def imports(source: Path, rel: Path):
    if source.name.endswith((".d.ts", ".d.mts")) or source.suffix not in (".ts", ".tsx", ".mjs", ".js", ".css"):
        return []
    raw = restrict_owner_surface(rel, source.read_text(encoding="utf-8"))
    found = []
    for spec in RELATIVE_IMPORT.findall(raw):
        prefix = rel.parent / spec
        # Normalize without allowing directory traversal outside apps/vox-web.
        match = None
        for candidate in (prefix, *[Path(str(prefix) + ext) for ext in EXT],
                          *[prefix / ("index" + ext) for ext in EXT]):
            base = source.parents[len(rel.parts) - 1].resolve()
            full = (base / candidate).resolve()
            if not full.is_relative_to(base):
                raise ValueError(f"Escaping VOX source tree: {rel} -> {spec}")
            if full.is_file():
                match = full.relative_to(base)
                break
        if match is None:
            raise FileNotFoundError(f"Unresolved import: {rel}: {spec}")
        found.append(match)
    return found

def extract(src: Path, dst: Path):
    src = src.resolve()
    dst = dst.resolve()
    source_base = src / ROOT
    target_base = dst / ROOT
    sha = subprocess.check_output(
        ["git", "-C", str(src), "rev-parse", "HEAD"], text=True).strip()
    queue = [Path(name) for name in CONFIG + ROUTES]
    selected = set()
    while queue:
        rel = queue.pop()
        if rel in selected:
            continue
        full = source_base / rel
        if not full.is_file():
            raise FileNotFoundError(str(full))
        if rel.parts[0] == "app" and len(rel.parts) > 2:
            # Never import excluded Staff/Finance/API routes transitively.
            if any(part in {"team", "staff-reviews", "finance", "studio",
                            "acquisition", "intelligence"} for part in rel.parts):
                raise ValueError(f"Forbidden activation surface in Owner build: {rel}")
        selected.add(rel)
        queue.extend(imports(full, rel))
        if rel.suffix == ".mjs":
            declaration = Path(str(rel)[:-4] + ".d.mts")
            if (source_base / declaration).is_file():
                queue.append(declaration)
    # Audit before writing; don't delete unrelated destination files.
    existing = {p.relative_to(target_base) for p in target_base.rglob("*")
                if p.is_file()} if target_base.exists() else set()
    if existing:
        raise RuntimeError("Destination VOX tree already exists; refuse overwrite")
    records = []
    for rel in sorted(selected):
        original = source_base / rel
        copy = target_base / rel
        copy.parent.mkdir(parents=True, exist_ok=True)
        modified = rel.as_posix() in {"app/operations/page.tsx", "app/vendor360/page.tsx",
                                        "app/api/overview/route.ts", "app/api/vendor360/route.ts"}
        source_bytes = original.read_bytes()
        final_bytes = (restrict_owner_surface(rel, original.read_text(encoding="utf-8")).encode("utf-8")
                       if modified else source_bytes)
        copy.write_bytes(final_bytes)
        record = {"path": str((ROOT / rel).as_posix()),
                  "sha256": hashlib.sha256(final_bytes).hexdigest()}
        if modified:
            record.update({"overlay": "owner_mode_only",
                           "source_sha256": hashlib.sha256(source_bytes).hexdigest()})
        records.append(record)
    # A separate minimal landing page; Owner verification remains server-auth gated.
    landing = target_base / "app/page.tsx"
    landing.write_bytes(('import {redirect} from "next/navigation";\n'
                         'export default function Home(){redirect("/operations");}\n').encode("utf-8"))
    records.append({"path": str((ROOT / "app/page.tsx").as_posix()),
                    "sha256": hashlib.sha256(landing.read_bytes()).hexdigest(),
                    "new": True})
    manifest = {
        "policy": "quickfurno.f0.owner-vox-minimal.v1",
        "source_sha": sha,
        "base_sha": subprocess.check_output(
            ["git", "-C", str(dst), "rev-parse", "HEAD"], text=True).strip(),
        "total_files": len(records),
        "allowed_routes": [str(x) for x in ROUTES],
        "unreviewed_staff_enabled": False,
        "production_authorized": False,
        "files": sorted(records, key=lambda x: x["path"]),
    }
    out = dst / "docs" / "launch" / "f0-owner-vox-file-manifest.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return manifest

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, required=True)
    args = parser.parse_args()
    result = extract(args.source, args.target)
    print(json.dumps({"source_sha": result["source_sha"],
                      "files": result["total_files"],
                      "manifest": "docs/launch/f0-owner-vox-file-manifest.json",
                      "release": "HOLD"}))
