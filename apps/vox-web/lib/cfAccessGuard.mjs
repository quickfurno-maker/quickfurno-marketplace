import {createRemoteJWKSet, jwtVerify} from "jose";

// This check is an additional trusted-origin boundary, never a replacement for
// Supabase Auth, real AAL2 or Core object/department authorization.
const TEAM=/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/;
const AUD=/^[a-f0-9]{64}$/;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cached=new Map();

export function cloudflareAccessSettings(env=process.env){
  const teamDomain=String(env.VOX_CF_ACCESS_TEAM_DOMAIN??"").replace(/\/$/,"");
  const audience=String(env.VOX_CF_ACCESS_AUD??"");
  const ownerEmail=String(env.VOX_CF_ACCESS_OWNER_EMAIL??"").toLowerCase();
  if(!TEAM.test(teamDomain)||!AUD.test(audience)||!EMAIL.test(ownerEmail)||ownerEmail.length>254)
    return null;
  return Object.freeze({teamDomain,audience,ownerEmail});
}

function remoteKeys(teamDomain) {
  if(!cached.has(teamDomain)){
    cached.set(teamDomain,createRemoteJWKSet(
      new URL(teamDomain+"/cdn-cgi/access/certs"),
      {timeoutDuration:2500,cooldownDuration:10000,cacheMaxAge:3600000}
    ));
  }
  return cached.get(teamDomain);
}

export async function verifyCloudflareAccessToken(token,settings,{keyResolver}={}){
  if(!settings||!TEAM.test(settings.teamDomain)||!AUD.test(settings.audience)||
    !EMAIL.test(settings.ownerEmail)||typeof token!=="string"||token.length<100||token.length>8192)
    return false;
  try{
    const {payload}=await jwtVerify(token,keyResolver??remoteKeys(settings.teamDomain),{
      issuer:settings.teamDomain,
      audience:settings.audience,
      algorithms:["RS256"],
      requiredClaims:["iss","aud","iat","exp","email"],
      clockTolerance:5
    });
    // Only the explicitly authorized verified Owner email is eligible.
    // Never accept a token issued for another Access application.
    return typeof payload.email==="string"&&payload.email.toLowerCase()===settings.ownerEmail;
  }catch{return false;}
}
