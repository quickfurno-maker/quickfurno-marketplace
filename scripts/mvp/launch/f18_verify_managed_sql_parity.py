#!/usr/bin/env python3
"""F18 source-to-Staging managed migration content proof (NO DB/network access).

Reads only the sanitized read-only operator-observed fingerprint manifest and
ten exact source SQL files. Never connects to managed Supabase or runs SQL.
The operator verified F7 single-statement source byte equality separately.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

VERSIONS=(
 "20261104090000","20261104140000","20261104153000",
 "20261104160000","20261104163000","20261104170000",
 "20261104173000","20261106113825","20261106114301",
 "20261106120124",
)
STAGING_REF="uckafzuochmbvtiodmcl"
MANIFEST="docs/launch/qf-f18-managed-sql-ledger-proof-20261107.json"
LEX_MODE={"normal","line_comment","block_comment","single","double","dollar"}

def split_pg_sql(src:str)->list[str]:
    """Split at unquoted ; with nested /* */ and dollar-quoted PL/pgSQL."""
    chunks=[]
    start=0
    i=0
    n=len(src)
    mode="normal"
    nesting=0
    tag=""
    while i<n:
        c=src[i]
        nxt=src[i+1] if i+1<n else ""
        if mode=="line_comment":
            if c=="\n":mode="normal"
            i+=1
            continue
        if mode=="block_comment":
            if c=="/" and nxt=="*":nesting+=1;i+=2;continue
            if c=="*" and nxt=="/":
                nesting-=1
                i+=2
                if nesting==0:mode="normal"
                continue
            i+=1
            continue
        if mode=="single":
            if c=="'" and nxt=="'":i+=2;continue
            if c=="'" and src[max(i-1,0)]!="\\":mode="normal"
            i+=1
            continue
        if mode=="double":
            if c=='"' and nxt=='"':i+=2;continue
            if c=='"':mode="normal"
            i+=1
            continue
        if mode=="dollar":
            if src.startswith(tag,i):
                i+=len(tag)
                mode="normal"
                continue
            i+=1
            continue
        if c=="-" and nxt=="-":mode="line_comment";i+=2;continue
        if c=="/" and nxt=="*":mode="block_comment";nesting=1;i+=2;continue
        if c=="'":mode="single";i+=1;continue
        if c=='"':mode="double";i+=1;continue
        if c=="$":
            match=re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$",src[i:])
            if match:
                tag=match.group(0)
                i+=len(tag)
                mode="dollar"
                continue
        if c==";":
            piece=src[start:i].strip()
            if piece:chunks.append(piece)
            start=i+1
        i+=1
    if mode not in ("normal","line_comment"):
        raise ValueError("UNTERMINATED_SQL_"+mode.upper())
    tail=src[start:].strip()
    if tail:chunks.append(tail)
    return chunks

def md5(raw:bytes)->str:
    return hashlib.md5(raw).hexdigest()

def verify_one(src:bytes,entry:dict)->list[str]:
    errors=[]
    if hashlib.sha256(src).hexdigest()!=entry.get("localSourceSha256"):
        errors.append("SOURCE_SHA256_DRIFT")
    try:
        text=src.decode("utf-8")
        statements=split_pg_sql(text)
    except (UnicodeDecodeError,ValueError):
        return errors+["SQL_LEXER_REJECTED"]
    if len(statements)!=entry.get("statementCount"):
        errors.append("STATEMENT_COUNT_DRIFT")
    mode=entry.get("comparisonMode")
    if mode=="split_trimmed_join":
        observed=md5("\n".join(statements).encode())
    elif mode=="full_source_exact":
        if len(statements)!=1:
            return errors+["EXPECTED_ONE_DOLLAR_DO_BLOCK"]
        observed=md5(src)
    elif mode=="single_terminated":
        if len(statements)!=1:
            return errors+["EXPECTED_ONE_TERMINATED_BLOCK"]
        observed=md5((statements[0]+";").encode())
    else:
        return errors+["UNAPPROVED_LEDGER_COMPARISON_MODE"]
    if observed!=entry.get("storedStatementMD5"):
        errors.append("MANAGED_LEDGER_CONTENT_DIFFERENCE")
    return errors

def verify(repo:Path, manifest:dict)->dict:
    errors=[]
    if not isinstance(manifest,dict):
        return {"valid":False,"errors":["INVALID_EVIDENCE"]}
    if manifest.get("schema")!="quickfurno.f18.real-managed-sql-ledger-proof.v1" or (
      manifest.get("stagingProjectId")!=STAGING_REF or
      manifest.get("observedDate")!="2026-11-07" or
      manifest.get("appliedMigrationVersionCount")!=10 or
      manifest.get("databaseReadOnly") is not True or
      manifest.get("databaseModified") is not False or
      manifest.get("exactByteContentParityVerified") is not True or
      manifest.get("secretsPresent") is not False or
      manifest.get("mayDeployStaging") is not False or
      manifest.get("mayDeployProduction") is not False or
      manifest.get("maySendOtp") is not False):
        errors.append("UNTRUSTED_MANAGED_STAGING_EVIDENCE")
    entries=manifest.get("versions",[])
    if not isinstance(entries,list) or len(entries)!=len(VERSIONS):
        return {"valid":False,"errors":errors+["WRONG_ENTRY_COUNT"]}
    versions=[e.get("version") for e in entries if isinstance(e,dict)]
    if versions!=list(VERSIONS):
        errors.append("UNEXPECTED_OR_REORDERED_LEDGER_VERSIONS")
    for e in entries:
        if not isinstance(e,dict):
            errors.append("MALFORMED_LEDGER_ROW")
            continue
        v=e.get("version")
        name=e.get("name")
        if not isinstance(v,str) or v not in VERSIONS or not isinstance(name,str) or not re.fullmatch(r"[a-z0-9_]+",name):
            errors.append("INVALID_LEDGER_FILE_ID")
            continue
        path=repo/"supabase"/"migrations"/(v+"_"+name+".sql")
        if not path.is_file():
            errors.append(v+":SQL_SOURCE_MISSING")
            continue
        errors.extend(v+":"+s for s in verify_one(path.read_bytes(),e))
    return {
     "schema":"quickfurno.f18.source-sql-parity.v1",
     "evidence":"MANAGED_STAGING_READ_ONLY_HASHES_PLUS_LOCAL_SOURCE",
     "actualDatabaseRecheckedByCI":False,
     "valid":not errors,
     "verifiedVersionCount":len(entries) if not errors else 0,
     "errors":errors,
     "mayDeployStaging":False,
     "maySendOtp":False,
     "mayDeployProduction":False,
     "releaseVerdict":"HOLD",
    }

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--repo",default=".")
    ap.add_argument("--manifest",default=MANIFEST)
    args=ap.parse_args()
    repo=Path(args.repo).resolve()
    try:
        evidence=json.loads((repo/args.manifest).read_text("utf-8"))
        output=verify(repo,evidence)
    except (OSError,json.JSONDecodeError):
        output={"valid":False,"errors":["EVIDENCE_MISSING_OR_MALFORMED"],"releaseVerdict":"HOLD"}
    print(json.dumps(output,sort_keys=True))
    raise SystemExit(0 if output.get("valid") else 1)
