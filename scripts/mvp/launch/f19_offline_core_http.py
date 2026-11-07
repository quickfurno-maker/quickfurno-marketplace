#!/usr/bin/env python3
"""F19 JARVIS Docker image HTTP integration rehearsal. Offline, no credentials.
Never starts external providers; refuses any port publication or network.
Does not inspect or print runtime secrets. Only synthetic placeholder variables.
"""
from __future__ import annotations
import json, subprocess, sys, time

IMAGE="qf-core-f17-candidate:cb9a1919"
REV="cb9a1919e5690f29e65da3bea6e09d4e174991b9"
NAME="qf-f19-offline-http-20261107"
JS=r"""
(async()=>{
const base="http://127.0.0.1:3000";
const cases=[
 ["liveness","GET","/livez",null,[200],null],
 ["vendor signup page","GET","/vendor?mode=signup",null,[200],"New Vendor Signup"],
 ["vendor login page","GET","/vendor?mode=login",null,[200],"Vendor Login"],
 ["vendor category deeplink","GET","/vendor?mode=signup&trade=carpenters",null,[200],"New Vendor Signup"],
 ["legacy register redirect","GET","/vendors/register",null,[307,308],"/vendor?mode=signup"],
 ["otp request disabled","POST","/api/vendor/onboarding/request-otp",{mobile:"9876543210"},[503],"WHATSAPP_OTP_NOT_YET_AVAILABLE"],
 ["atomic signup disabled","POST","/api/vendor/onboarding/complete",{mobile:"9876543210",token:"123456",registration:{}},[503],"VENDOR_SIGNUP_NOT_YET_AVAILABLE"],
 ["returning login request disabled","POST","/api/vendor/auth/login/request-otp",{mobile:"9876543210"},[503],"VENDOR_WHATSAPP_LOGIN_NOT_AVAILABLE"],
 ["returning login verify disabled","POST","/api/vendor/auth/login/verify-otp",{mobile:"9876543210",token:"123456"},[503],"VENDOR_WHATSAPP_LOGIN_NOT_AVAILABLE"],
 ["private document upload disabled","POST","/api/vendor/private-evidence",{not:"an upload"},[503],"PRIVATE_EVIDENCE_NOT_YET_AVAILABLE"],
 ["Owner queue disabled","GET","/api/vox/v1/owner-vendor-verification-queue",null,[503],"VENDOR_REVIEW_QUEUE_DISABLED"],
 ["Owner decision disabled","GET","/api/vox/v1/owner-vendor-verification-case?vendorId=00000000-0000-4000-8000-000000000001",null,[503],"OWNER_REVIEW_DISABLED"],
 ["Owner WhatsApp readiness refuses disconnected dependencies","GET","/api/vox/v1/owner-whatsapp-launch-readiness",null,[503],null],
 ["Meta GET without challenge denied","GET","/api/webhooks/whatsapp/meta",null,[403,503],null],
 ["Supabase Auth Hook GET denied","GET","/api/auth/hooks/supabase-send-sms",null,[405,503],null],
 ["unsigned Supabase Auth Hook POST denied","POST","/api/auth/hooks/supabase-send-sms",{otp:"123456"},[400,401,403,503],null],
 ["invalid Meta webhook POST denied","POST","/api/webhooks/whatsapp/meta",{object:"whatsapp_business_account",entry:[]},[400,401,403,503],null],
];
const results=[];
for(const [name,method,path,body,allowed,needle] of cases){
 let status=-1,ok=false,exception=false;
 try{
  const response=await fetch(base+path,{
   method,redirect:"manual",signal:AbortSignal.timeout(5000),
   headers:body?{"content-type":"application/json",origin:base}:{},
   body:body?JSON.stringify(body):undefined,
  });
  status=response.status;
  // Only compare fixed strings; NEVER print a response body.
  const data=await response.text();
  const haystack=status>=300&&status<400?response.headers.get("location")||"":data;
  ok=allowed.includes(status) && (!needle||haystack.includes(needle));
 }catch{exception=true}
 results.push({name,status,ok,exception});
}
const passed=results.filter(x=>x.ok).length;
console.log("F19_OFFLINE_HTTP_RESULT "+JSON.stringify({passed,total:results.length,failed:results.filter(x=>!x.ok),statusByName:results.map(x=>[x.name,x.status])}));
if(passed!==results.length)process.exitCode=5;
})().catch(()=>process.exit(6));
"""
def run(args:list[str],timeout=40):
 return subprocess.run(args,capture_output=True,text=True,timeout=timeout,check=False)

evidence={"schema":"quickfurno.f19.offline-core-http.v1",
 "mode":"JARVIS_DOCKER_NO_NETWORK","image":IMAGE,
 "imageRevisionExpected":REV,
 "syntheticPlaceholdersOnly":True,"noRealCredentials":True,
 "noPublishedPorts":True,"networkMode":"none","noExternalProviderCalls":True,
 "liveStagingModified":False,"databaseModified":False,
 "productionModified":False,"otpSent":False,"releaseVerdict":"HOLD",
 "temporaryContainerCleaned":False,
 "checksPassed":0,"checksTotal":0,"checks":[]}
created=False
try:
 inspected=run(["docker","image","inspect",IMAGE],timeout=20)
 if inspected.returncode!=0:raise RuntimeError("IMAGE_NOT_INSTALLED")
 row=json.loads(inspected.stdout)[0]
 label=row.get("Config",{}).get("Labels",{}).get("org.opencontainers.image.revision")
 if label!=REV:raise RuntimeError("SOURCE_REVISION_MISMATCH")
 evidence["imageId"]=row["Id"]
 exists=run(["docker","container","inspect",NAME],timeout=12)
 if exists.returncode==0:raise RuntimeError("EXISTING_TEST_CONTAINER_REFUSE")
 started=run(["docker","run","-d","--name",NAME,"--network","none",
  "--read-only","--tmpfs","/tmp:rw,nosuid,noexec,size=64m",
  "--cap-drop","ALL","--security-opt","no-new-privileges:true",
  "--memory","900m","--cpus","2","--pids-limit","128",
  "--env","QF_RUNTIME_ROLE=web",
  "--env","QF_RUNTIME_ENV=staging",
  "--env","QF_ALLOW_STAGING_RUNTIME=1",
  "--env","QF_CONFIG_SCHEMA_VERSION=1",
  "--env","QF_SERVICE_ID=quickfurno.web",
  "--env","NEXT_PUBLIC_SUPABASE_URL=https://uckafzuochmbvtiodmcl.supabase.co",
  "--env","NEXT_PUBLIC_SUPABASE_ANON_KEY=F19_FAKE_PUBLIC_ONLY",
  "--env","SUPABASE_SERVICE_ROLE_KEY=F19_FAKE_SERVICE_ONLY",
  IMAGE],timeout=40)
 if started.returncode!=0:raise RuntimeError("CONTAINER_BOOT_FAILED")
 created=True
 config=run(["docker","container","inspect",NAME],timeout=18)
 host=json.loads(config.stdout)[0]["HostConfig"]
 if host["NetworkMode"]!="none" or host.get("PortBindings"):
  raise RuntimeError("UNSAFE_CONTAINER_NETWORK_OR_PORTS")
 # The app may need several seconds to start; check health before testing
 # application routes, otherwise every request can race with boot.
 health_js="fetch('http://127.0.0.1:3000/livez',{signal:AbortSignal.timeout(1000)}).then(r=>process.exit(r.status===200?0:7)).catch(()=>process.exit(8))"
 for _ in range(45):
  health=run(["docker","exec",NAME,"node","-e",health_js],timeout=5)
  if health.returncode==0:break
  time.sleep(1)
 else:raise RuntimeError("ISOLATED_LOCAL_CORE_NOT_READY")
 probe=run(["docker","exec",NAME,"node","-e",JS],timeout=110)
 if "F19_OFFLINE_HTTP_RESULT " not in probe.stdout:
  raise RuntimeError("HTTP_RESULT_NOT_RECEIVED")
 data=json.loads(probe.stdout.split("F19_OFFLINE_HTTP_RESULT ",1)[1].strip())
 evidence["checksPassed"]=data["passed"]
 evidence["checksTotal"]=data["total"]
 evidence["checks"]=data["statusByName"]
 evidence["failedChecks"]=data["failed"]
 evidence["success"]=probe.returncode==0 and data["passed"]==data["total"]
except (RuntimeError,ValueError,KeyError,subprocess.TimeoutExpired,OSError) as exc:
 evidence["success"]=False
 evidence["errorCode"]=str(exc)[:80] if isinstance(exc,RuntimeError) else type(exc).__name__
finally:
 if created:
  removed=run(["docker","rm","--force",NAME],timeout=30)
  evidence["temporaryContainerCleaned"]=removed.returncode==0
print(json.dumps(evidence,sort_keys=True))
sys.exit(0 if evidence.get("success") and evidence["temporaryContainerCleaned"] else 1)
