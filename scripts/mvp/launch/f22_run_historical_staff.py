#!/usr/bin/env python3
"""F22 isolated historical-Staff source test runner.

Runs 24 original, sha256-pinned tests ONLY in their own detached original
Staff branch checkout. Current Owner-only VOX is NEVER changed or granted
Staff features by this runner. No live provider credentials allowed.
The three compiled HTTP tests use local loopback 127.0.0.1 exclusively.
"""
from __future__ import annotations
from pathlib import Path
import argparse,hashlib,json,os,re,subprocess,sys,time
REPO=Path(__file__).resolve().parents[3]
MANIFEST=REPO/"docs/launch/qf-f22-legacy-vox-archive-20261107.json"
SHA="015ad722c543b2106b0b46f3fc573e16c4edee63"
LOCAL_HTTP={
 "validate-rc37-navigation-401.spec.mjs",
 "validate-rc38-refund-review-readonly.spec.mjs",
 "validate-rc40-staff-uat-recovery.spec.mjs",
}
STATIC_FETCH_LITERAL={"validate-staff-proposals-12b.mjs"}
def digest(data:bytes)->str:return hashlib.sha256(data).hexdigest()
def make_env()->dict[str,str]:
 env={k:v for k,v in os.environ.items() if not re.search(
  r"(TOKEN|SECRET|SUPABASE|WHATSAPP|META_|AUTH|DATABASE|POSTGRES|JWT|SERVICE_ROLE|OPENAI|API_KEY|CLOUDFLARE|RAZORPAY|GITHUB)",k,re.I)}
 env.update({"CI":"1","NEXT_TELEMETRY_DISABLED":"1",
  "NEXT_PUBLIC_SUPABASE_URL":"https://fixture.invalid",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY":"F22_FAKE_PUBLIC_ONLY",
  "SUPABASE_SERVICE_ROLE_KEY":"F22_FAKE_SERVICE_ONLY"})
 return env
def run_cmd(args,cwd,env,timeout):
 try:
  p=subprocess.run(args,cwd=cwd,env=env,text=True,errors="replace",
    capture_output=True,timeout=timeout,check=False)
  return p.returncode,p.stdout,p.stderr
 except (OSError,subprocess.TimeoutExpired):
  return -1,"",""
def main(staff:Path,build:bool)->dict:
 out={"schema":"quickfurno.f22.historical-staff-script-real-ci.v1",
  "expectedHistoricalSha":SHA,"currentOwnerHostModified":False,
  "realProviderCredentialsUsed":False,
  "localCompiledTestsUseLoopbackOnly":True,
  "externalConfigOrDatabaseChanges":False,
  "releaseVerdict":"HOLD","mayDeployStaging":False,
  "maySendOtp":False,"mayDeployProduction":False,
  "scriptResults":[],"sourceRevisionVerified":False,
  "historicalBuildPassed":False,"valid":False}
 staff=staff.resolve()
 app=staff/"apps/vox-web"
 env=make_env()
 code,sha,_=run_cmd(["git","rev-parse","HEAD"],staff,env,20)
 if code!=0 or sha.strip()!=SHA:
  out["error"]="HISTORICAL_COMMIT_MISMATCH";return out
 out["sourceRevisionVerified"]=True
 try:manifest=json.loads(MANIFEST.read_text("utf8"))
 except (OSError,ValueError):
  out["error"]="ARCHIVE_EVIDENCE_MISSING";return out
 rows=manifest.get("records",[])
 if len(rows)!=24:out["error"]="HISTORICAL_SCRIPT_COUNT_INVALID";return out
 # Always verify both the currently archived original bytes and the checked
 # out historical test source bytes before running any executable code.
 ordered=[]
 for item in rows:
  src=item["historicalPath"]
  if not src.startswith("apps/vox-web/scripts/") or not src.endswith(".mjs"):
   out["error"]="UNAPPROVED_HISTORICAL_TEST_PATH";return out
  actual=(staff/src).read_bytes()
  original=(REPO/item["archivedPath"]).read_bytes()
  if (actual!=original or digest(actual)!=item["sha256"] or
      item["historicalGitSourceCommit"]!=SHA):
   out["error"]="HISTORICAL_SCRIPT_SOURCE_MISMATCH";return out
  ordered.append(Path(src).name)
 if len(set(ordered))!=24:
  out["error"]="DUPLICATE_HISTORICAL_TEST";return out
 if build:
  cmd=["npm.cmd" if os.name=="nt" else "npm","run","build","--","--webpack"]
  status,_,_=run_cmd(cmd,app,env,200)
  if status!=0:out["error"]="HISTORICAL_LOCAL_BUILD_FAILED";return out
 if not (app/".next/BUILD_ID").is_file():
  out["error"]="HISTORICAL_LOCAL_BUILD_ABSENT";return out
 out["historicalBuildPassed"]=True
 for name in sorted(ordered):
  file=app/"scripts"/name
  text=file.read_text("utf8")
  if name in LOCAL_HTTP:
   if ('"127.0.0.1"' not in text or
       '"-H","127.0.0.1"' not in text or
       "spawn(process.execPath" not in text or
       "fetch(base+" not in text):
    out["error"]="LOCAL_HTTP_TEST_HOST_NOT_PINNED";return out
   args=["node","--test",str(file)]
  else:
   if (name not in STATIC_FETCH_LITERAL and
       re.search(r"\bfetch\s*\(|\bspawn\s*\(|\bexec\s*\(",text)):
    out["error"]="UNREVIEWED_NETWORK_OR_PROCESS_TEST";return out
   # Node's permissions deny child processes; archived tests only read their
   # own code and pinned, separately installed historical dependencies.
   dependency_path=(app/"node_modules" if (app/"node_modules").exists() else staff/"node_modules").resolve()
   args=["node","--experimental-vm-modules","--permission",
      "--allow-fs-read="+str(staff),
      "--allow-fs-read="+str(dependency_path),str(file)]
  status,stdout,_=run_cmd(args,app,env,90)
  skip=bool(re.search(r"(?mi)(?:#|ℹ)\s+(?:skipped|skip)\s+[1-9]\d*",stdout))
  passed=status==0 and not skip
  out["scriptResults"].append({"script":name,"passed":passed,
    "compiledHttp":name in LOCAL_HTTP,"noTestSkipped":not skip})
  if not passed:
   out["error"]="HISTORICAL_STAFF_TEST_FAILED:"+name
   return out
 out["scriptsPassed"]=sum(x["passed"] for x in out["scriptResults"])
 out["scriptsTotal"]=24
 out["compiledHttpScriptCount"]=sum(x["compiledHttp"] for x in out["scriptResults"])
 out["valid"]=out["scriptsPassed"]==24 and out["compiledHttpScriptCount"]==3
 return out
if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--staff-root",required=True)
 parser.add_argument("--build",action="store_true")
 a=parser.parse_args()
 try:r=main(Path(a.staff_root),a.build)
 except (OSError,ValueError,KeyError,TypeError):
  r={"schema":"quickfurno.f22.historical-staff-script-real-ci.v1",
   "valid":False,"error":"SOURCE_OR_EXECUTION_ERROR","releaseVerdict":"HOLD"}
 print(json.dumps(r,sort_keys=True))
 raise SystemExit(0 if r.get("valid") else 1)
