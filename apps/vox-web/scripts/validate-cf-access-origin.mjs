import assert from "node:assert/strict";
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from "jose";
import {cloudflareAccessSettings,verifyCloudflareAccessToken} from "../lib/cfAccessGuard.mjs";

const env={
 VOX_CF_ACCESS_TEAM_DOMAIN:"https://my-team.cloudflareaccess.com",
 VOX_CF_ACCESS_AUD:"a".repeat(64),
 VOX_CF_ACCESS_OWNER_EMAIL:"owner@example.org"
};
const settings=cloudflareAccessSettings(env);
assert(settings);
const {privateKey,publicKey}=await generateKeyPair("RS256");
const jwk=await exportJWK(publicKey);
const resolver=createLocalJWKSet({keys:[{...jwk,kid:"kid-A",alg:"RS256",use:"sig"}]});
const make=async (overrides={})=>{
 const now=Math.floor(Date.now()/1000);
 const {iss=settings.teamDomain,aud=settings.audience,email=settings.ownerEmail,iat=now,exp=now+300}=overrides;
 return new SignJWT({email})
  .setProtectedHeader({alg:"RS256",kid:"kid-A"})
  .setIssuer(iss).setAudience(aud).setIssuedAt(iat).setExpirationTime(exp)
  .sign(privateKey);
};
const check=(token,settingsOverride=settings)=>verifyCloudflareAccessToken(token,settingsOverride,{keyResolver:resolver});
const good=await make();
assert.equal(await check(good),true,"signed exact Owner token accepted");
assert.equal(await check(await make({email:"staff@example.org"})),false,"staff email rejected");
assert.equal(await check(await make({aud:"b".repeat(64)})),false,"wrong application audience rejected");
assert.equal(await check(await make({iss:"https://other.cloudflareaccess.com"})),false,"wrong team issuer rejected");
assert.equal(await check(await make({exp:Math.floor(Date.now()/1000)-120})),false,"expired JWT rejected");
assert.equal(await check("a.b.c"),false,"malformed JWT rejected");
assert.equal(await check(good.slice(0,-1)+"0"),false,"tampered signature rejected");
assert.equal(await check(good,null),false,"missing settings rejected");
assert.equal(await check(null),false,"missing Access header rejected");
assert.equal(cloudflareAccessSettings({}),null,"default fails closed");
assert.equal(cloudflareAccessSettings({...env,VOX_CF_ACCESS_TEAM_DOMAIN:"https://evil.example.com"}),null,"foreign JWKS origin rejected");
assert.equal(cloudflareAccessSettings({...env,VOX_CF_ACCESS_AUD:"bad"}),null,"missing app audience rejected");
assert.equal(cloudflareAccessSettings({...env,VOX_CF_ACCESS_OWNER_EMAIL:"bad"}),null,"invalid owner claim rejected");
console.log("VOX_CF_ACCESS_SIGNED_ORIGIN_GUARD_PASS 13/13");
