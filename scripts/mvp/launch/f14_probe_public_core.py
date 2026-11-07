#!/usr/bin/env python3
"""F14: non-mutating TLS GET probes for the actual public Staging Core ingress.
No auth token, OTP, POST, redirects, or callback challenge is ever sent.
"""
import json
import ssl
import urllib.error
import urllib.request

BASE="https://staging-core.quickfurno.in"
ENDPOINTS={
 "/livez":200,
 "/api/webhooks/whatsapp/meta":403,
 "/api/auth/hooks/supabase-send-sms":405,
 "/api/vox/v1/owner-whatsapp-launch-readiness":404,
}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None
def probe(open_fn=None):
    op=open_fn or urllib.request.build_opener(NoRedirect).open
    out={}
    for path,expected in ENDPOINTS.items():
        url=BASE+path
        request=urllib.request.Request(url,method="GET",
            headers={"User-Agent":"QuickFurno-F14-NoSend-Readonly-Preflight"})
        try:
            response=op(request,timeout=12)
            status=response.status
            response.close()
            tls_verified=True
        except urllib.error.HTTPError as e:
            status=e.code
            e.close()
            tls_verified=True
        except (urllib.error.URLError,ssl.SSLError,TimeoutError,OSError):
            status=None;tls_verified=False
        out[path]={"httpStatus":status,"tlsVerified":tls_verified,
                   "expected":expected,"boundaryMatched":status==expected and tls_verified}
    return {"schema":"quickfurno.f14.direct-staging-core-get-only.v1",
        "method":"GET", "redirectsFollowed":False, "host":"staging-core.quickfurno.in",
        "networkExecuted":True,"checks":out,
        "allBoundariesMatched":all(x["boundaryMatched"] for x in out.values()),
        "providerDashboardCallbackRegistered":False,
        "supabaseAuthHookConfigured":False,
        "realSignedCallbackVerified":False,
        "releaseVerdict":"HOLD","maySendOtp":False,"mayDeployStaging":False}
if __name__=="__main__":
    print(json.dumps(probe(),sort_keys=True))
