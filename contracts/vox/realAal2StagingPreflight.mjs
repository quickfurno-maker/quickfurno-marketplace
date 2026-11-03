// Offline claims preflight ONLY. This module does not authenticate JWT signatures.
// Protected Staging endpoints MUST independently verify each bearer through GoTrue.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const deny=code=>{throw Error("VO8_AAL2_PREFLIGHT_"+code);};
export function preflightThreeRealAal2(tokens,{expectedIssuer,now=Math.floor(Date.now()/1000)}={}){
 if(!Array.isArray(tokens)||tokens.length!==3||
    tokens.some(t=>typeof t!=="string"||t.length<80||t.length>8192||!JWT.test(t)))
  deny("THREE_BEARERS_REQUIRED");
 if(new Set(tokens).size!==3)deny("DUPLICATE_BEARER");
 let issuer;
 try{issuer=new URL(expectedIssuer);}catch{deny("ISSUER_CONFIG_REQUIRED");}
 if(issuer.protocol!=="https:"||issuer.username||issuer.password||issuer.search||issuer.hash||
    !issuer.pathname.replace(/\/$/,"").endsWith("/auth/v1")||
    issuer.origin==="https://localhost")deny("ISSUER_CONFIG_INVALID");
 const canonical=issuer.href.replace(/\/$/,"");
 if(!Number.isSafeInteger(now)||now<1700000000)deny("CLOCK_INVALID");
 const identities=tokens.map(token=>{
  let c;
  try{c=JSON.parse(Buffer.from(token.split(".")[1],"base64url").toString("utf8"));}
  catch{deny("MALFORMED_CLAIMS");}
  if(!c||typeof c!=="object"||Array.isArray(c))deny("MALFORMED_CLAIMS");
  if(c.iss!==canonical||c.aal!=="aal2"||c.is_anonymous===true||
     c.aud!=="authenticated"||!UUID.test(c.sub||"")||
     !UUID.test(c.session_id||"")||
     !Number.isSafeInteger(c.iat)||c.iat>now+30||
     !Number.isSafeInteger(c.exp)||c.exp<=now+60||c.exp>now+86400)
    deny("CLAIMS_NOT_ELIGIBLE");
  return Object.freeze({sub:c.sub,sessionId:c.session_id,exp:c.exp});
 });
 if(new Set(identities.map(x=>x.sub)).size!==3)deny("DISTINCT_PRINCIPALS_REQUIRED");
 if(new Set(identities.map(x=>x.sessionId)).size!==3)deny("DISTINCT_SESSIONS_REQUIRED");
 return Object.freeze(identities);
}
