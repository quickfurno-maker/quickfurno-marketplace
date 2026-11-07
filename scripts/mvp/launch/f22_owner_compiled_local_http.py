#!/usr/bin/env python3
"""F22 NO-DEPLOY local-only compiled Owner VOX HTTP checks.

Launches the *locally built* standalone VOX on loopback with synthetic
configuration and no real service credentials. Never contacts Meta,
managed Supabase or any Staging/Production host. Cleans up subprocess tree.
Runs on JARVIS Windows and GitHub Actions Linux.
"""
from __future__ import annotations
from pathlib import Path
import http.client,json,os,re,signal,socket,subprocess,sys,time

REPO=Path(__file__).resolve().parents[3]
APP=REPO/"apps/vox-web"
PORT=3188
CASES=[
 ("owner_login_page","GET","/login",None,(200,)),
 ("owner_verification_page_default_hold","GET","/owner/vendors/verification",None,(200,302,307,308)),
 ("owner_queue_disabled","GET","/api/owner/vendor-verification/queue",None,(503,)),
 ("owner_case_disabled","GET","/api/owner/vendor-verification/case?vendorId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",None,(503,)),
 ("owner_decision_denied","POST","/api/owner/vendor-verification/decision",b"{}",(403,503)),
 ("staff_vendor_360_disabled","GET","/api/vendor360",None,(401,403,503)),
]
def local_request(method,path,body):
 c=http.client.HTTPConnection("127.0.0.1",PORT,timeout=3)
 headers={"origin":"http://127.0.0.1:"+str(PORT)} if method=="POST" else {}
 if body is not None:headers["Content-Type"]="application/json"
 try:
  c.request(method,path,body=body,headers=headers)
  response=c.getresponse()
  status,location=response.status,response.getheader("location")
  response.read(4096)
  return status,location
 finally:c.close()
def run():
 result={"schema":"quickfurno.f22.compiled-owner-local-http.v1",
  "application":"F22 current Owner-only VOX",
  "localhostOnly":True,"host":"127.0.0.1","port":PORT,
  "syntheticCredentialsOnly":True,"realProviderCallsAuthorized":False,
  "liveStagingModified":False,"productionModified":False,
  "releaseVerdict":"HOLD","mayDeployStaging":False,
  "maySendOtp":False,"mayDeployProduction":False,
  "checks":[],"temporaryServerCleaned":False,"success":False}
 if not (APP/".next/BUILD_ID").is_file():
  result["failureCode"]="COMPILED_OWNER_BUILD_REQUIRED"
  return result
 bins=[APP/"node_modules/next/dist/bin/next",REPO/"node_modules/next/dist/bin/next"]
 binpath=next((x for x in bins if x.is_file()),None)
 if binpath is None:
  result["failureCode"]="NEXT_RUNTIME_MISSING"
  return result
 with socket.socket() as sock:
  if sock.connect_ex(("127.0.0.1",PORT))==0:
   result["failureCode"]="LOCAL_PORT_ALREADY_OCCUPIED"
   return result
 env={k:v for k,v in os.environ.items() if not re.search(
   r"(TOKEN|SECRET|SUPABASE|WHATSAPP|META_|AUTH|DATABASE|POSTGRES|JWT|SERVICE_ROLE|OPENAI|API_KEY|CLOUDFLARE|RAZORPAY|GITHUB)",k,re.I)}
 env.update({"NODE_ENV":"production","NEXT_TELEMETRY_DISABLED":"1",
  "NEXT_PUBLIC_SUPABASE_URL":"https://fixture.invalid",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY":"F22_FAKE_PUBLIC_ONLY",
  "SUPABASE_SERVICE_ROLE_KEY":"F22_FAKE_SERVICE_ONLY",
  "VOX_STAFF_PORTAL_ENABLED":"",
  "VOX_OWNER_VENDOR_REVIEW_ENABLED":"",
  "VOX_OWNER_VENDOR_DECISION_ENABLED":""})
 child=None
 try:
  spawn_opt={"creationflags":subprocess.CREATE_NEW_PROCESS_GROUP} if os.name=="nt" else {"start_new_session":True}
  child=subprocess.Popen(["node",str(binpath),"start","-H","127.0.0.1","-p",str(PORT)],
   cwd=APP,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
   stdin=subprocess.DEVNULL,**spawn_opt)
  for _ in range(48):
   if child.poll() is not None:raise RuntimeError("LOCAL_OWNER_SERVER_EXITED")
   try:
    if local_request("GET","/login",None)[0]==200:break
   except (OSError,TimeoutError):pass
   time.sleep(.5)
  else:raise RuntimeError("LOCAL_OWNER_READINESS_TIMEOUT")
  for name,method,path,body,allowed in CASES:
   try:
    status,location=local_request(method,path,body)
    ok=status in allowed and (
     location is None or not location.startswith(("http://","https://"))
     or location.startswith("http://127.0.0.1:"+str(PORT)))
   except (OSError,TimeoutError):
    status,ok=-1,False
   result["checks"].append({"name":name,"status":status,"pass":ok})
  result["checksPassed"]=sum(bool(c["pass"]) for c in result["checks"])
  result["checksTotal"]=len(CASES)
  result["success"]=result["checksPassed"]==result["checksTotal"]
 except (OSError,RuntimeError) as ex:
  result["failureCode"]=str(ex)[:80]
 finally:
  if child is not None:
   if os.name=="nt":
    subprocess.run(["taskkill","/T","/F","/PID",str(child.pid)],
      capture_output=True,timeout=20,check=False)
   else:
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
   try:child.wait(timeout=10)
   except subprocess.TimeoutExpired:
    if os.name=="nt":child.kill()
    else:
     try:os.killpg(child.pid,signal.SIGKILL)
     except ProcessLookupError:pass
   result["temporaryServerCleaned"]=child.poll() is not None
 return result
if __name__=="__main__":
 try:r=run()
 except Exception:r={"schema":"quickfurno.f22.compiled-owner-local-http.v1",
   "success":False,"failureCode":"UNEXPECTED_LOCAL_TEST_EXCEPTION",
   "releaseVerdict":"HOLD"}
 print(json.dumps(r,sort_keys=True))
 raise SystemExit(0 if r.get("success") and r.get("temporaryServerCleaned") else 1)
