/**
 * F11: repeatable real-host, NO SEND, NO TOKEN, GET-only observation.
 * No POSTs, no signature/OTP, no Auth/Meta Cloud provider call, no DB mutation.
 * The configured actual callback URLs are NOT known from this probe. Only
 * observes whether VOX host matches callback route origin compatibility.
 * Does not follow Cloudflare Access redirects.
 */
import {assessF11CallbackEvidence,isCloudflareAccessRedirect} from "./f11-callback-perimeter-policy.mjs";
const ORIGIN="https://vox.quickfurno.in";
const endpoints=[
  {owner:"meta",path:"/api/webhooks/whatsapp/meta?hub.mode=subscribe&hub.challenge=f11-readonly-no-secret"},
  {owner:"supabase",path:"/api/auth/hooks/supabase-send-sms"},
  {owner:"owner",path:"/api/vox/v1/owner-whatsapp-launch-readiness"},
];
if(!process.argv.includes("--execute")){
 console.log(JSON.stringify({schema:"qf.f11.public-callback-probe.v1",
  networkExecuted:false,noPost:true,configuredHookUrlsVerified:false,
  status:"DRY_RUN_NO_NETWORK",verdict:"HOLD"}));
 process.exit(0);
}
if(process.argv.some(a=>!["--execute"].includes(a)&&a!==process.argv[0]&&a!==process.argv[1])){
 console.error("F11_INVALID_ARGUMENTS_NO_NETWORK");process.exit(3);
}
const observed=[];
for(const item of endpoints){
 try{
  const r=await fetch(ORIGIN+item.path,{
   method:"GET",redirect:"manual",signal:AbortSignal.timeout(7000),
   headers:{accept:"application/json"},
  });
  const location=r.headers.get("location");
  observed.push({owner:item.owner,status:r.status,
   intercepted:isCloudflareAccessRedirect(r.status,location),
   // There is deliberately no response body, raw Location, cookie or token.
   tlsAssurance:"NODE_DEFAULT_TLS",
  });
 }catch{
  observed.push({owner:item.owner,status:null,intercepted:false,
   tlsAssurance:"UNVERIFIED",networkError:true});
 }
}
const evidence=assessF11CallbackEvidence({
 // The actual Meta/Supabase configured URL must be read from provider UI;
 // never pretend the tested VOX host is automatically the real callback.
 observed:observed.filter(x=>x.owner!=="owner").map(x=>({
  owner:x.owner,status:x.status,
  location:x.intercepted?"https://test.cloudflareaccess.com/cdn-cgi/access/login":""
 })),
 vendorQuality:"RED",
});
console.log(JSON.stringify({
 schema:"qf.f11.public-callback-probe.v1",networkExecuted:true,noPost:true,
 sourceHost:"vox.quickfurno.in",configuredHookUrlsVerified:false,
 observed,verdict:"HOLD",maySendOtp:false,
 blockers:evidence.blockers,
}));
