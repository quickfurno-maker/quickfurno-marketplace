#!/usr/bin/env python3
"""F14 read-only collector on authorized JARVIS -> configured qf-staging SSH.
Only outputs allowlisted sanitized fields. Never print raw docker inspect JSON,
tokens, secrets, OTPs, phone numbers or container environment variable values.
No commands that modify Docker, the VM, Supabase or provider settings.
"""
import argparse
import json
import re
import subprocess
import sys

CONTAINER = "qf-core-staging"
HOST = "qf-staging"
CLIENT_WABA = "27861262223494153"
CLIENT_PHONE = "1333595106493545"
VENDOR_WABA = "1569174604351612"
VENDOR_PHONE = "1088396637681784"
STALE_WABA = "2920988211610262"
REQUIRED_ENV = [
 "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_WABA_ID", "WHATSAPP_PHONE_NUMBER_ID",
 "WHATSAPP_VENDOR_ACCESS_TOKEN", "WHATSAPP_VENDOR_WABA_ID",
 "WHATSAPP_VENDOR_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET",
 "WHATSAPP_WEBHOOK_VERIFY_TOKEN", "SEND_SMS_HOOK_SECRETS",
]
def evaluate(raw, *, live):
    if not isinstance(raw, list) or len(raw) != 1:
        raise ValueError("F14_EXPECT_EXACTLY_ONE_CONTAINER")
    c = raw[0]
    if c.get("Name") != "/" + CONTAINER:
        raise ValueError("F14_UNEXPECTED_CONTAINER")
    env={}
    for item in c.get("Config",{}).get("Env",[]):
        if isinstance(item,str) and "=" in item:
            name,value=item.split("=",1)
            if name not in env: env[name]=value
    client_pair=(env.get("WHATSAPP_WABA_ID"),env.get("WHATSAPP_PHONE_NUMBER_ID"))
    vendor_pair=(env.get("WHATSAPP_VENDOR_WABA_ID"),env.get("WHATSAPP_VENDOR_PHONE_NUMBER_ID"))
    if client_pair==(CLIENT_WABA, CLIENT_PHONE): sender="RIYA_CLIENT"
    elif client_pair==(STALE_WABA,VENDOR_PHONE): sender="STALE_VENDOR_WABA"
    elif client_pair==(VENDOR_WABA,VENDOR_PHONE): sender="VENDOR_MISUSED_AS_DEFAULT"
    elif not all(client_pair): sender="INCOMPLETE"
    else: sender="UNEXPECTED"
    image_ref=c.get("Config",{}).get("Image","")
    image_id=c.get("Image","")
    sha=env.get("QF_RELEASE_SHA","")
    safe_sha=sha if re.fullmatch(r"[0-9a-f]{8}(?:[0-9a-f]{32})?",sha) else "UNVERIFIED"
    state=c.get("State",{})
    return {
      "schema":"quickfurno.f14.live-staging-runtime-inventory.v1",
      "observationMode":"LIVE_READ_ONLY_SSH" if live else "SYNTHETIC_FIXTURE_ONLY",
      "networkExecuted":bool(live),
      "containerName":CONTAINER,
      "imageTag":image_ref if image_ref.startswith("qf-core-staging:") else "OTHER",
      "imageId":image_id if re.fullmatch(r"sha256:[0-9a-f]{64}",image_id) else "UNKNOWN",
      "imageReleaseSha":safe_sha,
      "state":"running" if state.get("Running") is True else "not_running",
      "health":state.get("Health",{}).get("Status","not_reported"),
      "startedAt":state.get("StartedAt",""),
      "senderClassification":sender,
      "vendorPairExact":vendor_pair==(VENDOR_WABA,VENDOR_PHONE),
      "clientTokenPresent":bool(env.get("WHATSAPP_ACCESS_TOKEN")),
      "vendorTokenPresent":bool(env.get("WHATSAPP_VENDOR_ACCESS_TOKEN")),
      "requiredEnvPresent":[n for n in REQUIRED_ENV if bool(env.get(n))],
      "requiredEnvMissing":[n for n in REQUIRED_ENV if not env.get(n)],
      "environmentValuesEmitted":False,
      "mayDeployStaging":False,
      "maySendOtp":False,
      "releaseVerdict":"HOLD",
    }
def collect_live():
    cmd=["ssh","-o","BatchMode=yes","-o","ConnectTimeout=10",HOST,
         "docker","inspect",CONTAINER]
    p=subprocess.run(cmd,capture_output=True,text=True,timeout=40,check=False)
    if p.returncode!=0: raise RuntimeError("F14_REMOTE_INSPECT_FAILED")
    return json.loads(p.stdout)
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--fixture",help="local JSON mock, NEVER counted as live proof")
    options=parser.parse_args()
    try:
        if options.fixture:
            with open(options.fixture,encoding="utf-8") as f: raw=json.load(f)
        else: raw=collect_live()
        print(json.dumps(evaluate(raw,live=not bool(options.fixture)),sort_keys=True))
    except (ValueError,RuntimeError,subprocess.TimeoutExpired,FileNotFoundError,KeyError,json.JSONDecodeError) as ex:
        # No raw command lines, subprocess output, or secret-bearing JSON in failures.
        print(json.dumps({"schema":"quickfurno.f14.live-staging-runtime-inventory.v1",
                          "networkExecuted":False,"releaseVerdict":"HOLD",
                          "mayDeployStaging":False,"maySendOtp":False,
                          "errorCode":type(ex).__name__}),file=sys.stdout)
        sys.exit(1)
if __name__=="__main__": main()
