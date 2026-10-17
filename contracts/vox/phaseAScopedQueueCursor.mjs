/**
 * Phase A keyset cursor contract. PREPARED ONLY: not a live queue reader.
 * Bind to authenticated Staff, team, city, effective grant fingerprint and
 * last verified work row, with bounded 5-minute expiry. No numeric OFFSET.
 */
import {createHmac,timingSafeEqual} from "node:crypto";
const id=x=>typeof x==="string"&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
const sha=x=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
const secretValid=x=>typeof x==="string"&&x.length>=32&&x.length<=256;
const deny=reason=>Object.freeze({ok:false,reason,mayReadNextPage:false});
const validScope=s=>s&&id(s.userId)&&id(s.teamId)&&id(s.cityId)&&
 s.currentAal==="aal2"&&s.canReadContent===true&&s.canMutate===false&&
 sha(s.effectiveGrantsSha256);
const sign=(secret,data)=>createHmac("sha256",secret).update(data).digest("base64url");
const fields=["version","userId","teamId","cityId","grants",
 "lastReferenceId","lastSource","lastUpdated","issuedAtMs","expiresAtMs"];
const encode=o=>JSON.stringify(fields.map(f=>[f,o[f]]));
export function issueScopedQueueCursor({scope,lastRow,secret,now=Date.now()}={}){
 if(!validScope(scope)||!secretValid(secret)||!Number.isSafeInteger(now)||
  !lastRow||!id(lastRow.referenceId)||
  !["CORE_WORK_LEDGER","CORE_CLIENT_RIYA"].includes(lastRow.source)||
  typeof lastRow.updatedAt!=="string"||
  !Number.isFinite(Date.parse(lastRow.updatedAt))||
  Date.parse(lastRow.updatedAt)>now+30000)return deny("CURRENT_SCOPE_AND_ROW_REQUIRED");
 const body=encode({version:1,userId:scope.userId,teamId:scope.teamId,
  cityId:scope.cityId,grants:scope.effectiveGrantsSha256,
  lastReferenceId:lastRow.referenceId,lastSource:lastRow.source,
  lastUpdated:lastRow.updatedAt,issuedAtMs:now,expiresAtMs:now+300000});
 const bytes=Buffer.from(body).toString("base64url");
 const token=bytes+"."+sign(secret,bytes);
 return Object.freeze({ok:true,token,mayReadNextPage:false,
  requiresFreshDbObjectGrant:true,expiresAtMs:now+300000});
}
export function verifyScopedQueueCursor({token,scope,secret,now=Date.now()}={}){
 if(!validScope(scope)||!secretValid(secret)||!Number.isSafeInteger(now)||
  typeof token!=="string"||token.length>700||token.length<100)
  return deny("UNTRUSTED_CURSOR");
 const parts=token.split(".");
 if(parts.length!==2||!/^[A-Za-z0-9_-]+$/.test(parts[0])||
  !/^[A-Za-z0-9_-]{43}$/.test(parts[1]))return deny("UNTRUSTED_CURSOR");
 try{
  const actual=Buffer.from(parts[1],"base64url");
  const expected=Buffer.from(sign(secret,parts[0]),"base64url");
  if(actual.length!==32||!timingSafeEqual(actual,expected))
   return deny("INVALID_QUEUE_CURSOR_SIGNATURE");
  const pairs=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
  if(!Array.isArray(pairs)||pairs.length!==fields.length||
   pairs.some((row,i)=>!Array.isArray(row)||row.length!==2||
    row[0]!==fields[i]))return deny("INVALID_QUEUE_CURSOR_SHAPE");
  const data=Object.fromEntries(pairs);
  if(data.version!==1||data.userId!==scope.userId||
   data.teamId!==scope.teamId||data.cityId!==scope.cityId||
   data.grants!==scope.effectiveGrantsSha256||
   !id(data.lastReferenceId)||
   !["CORE_WORK_LEDGER","CORE_CLIENT_RIYA"].includes(data.lastSource)||
   typeof data.lastUpdated!=="string"||
   !Number.isFinite(Date.parse(data.lastUpdated))||
   !Number.isSafeInteger(data.issuedAtMs)||
   !Number.isSafeInteger(data.expiresAtMs)||
   data.issuedAtMs>now+30000||
   data.expiresAtMs<=now||
   data.expiresAtMs>data.issuedAtMs+300000)
   return deny("STALE_OR_FOREIGN_QUEUE_CURSOR");
  return Object.freeze({ok:true,lastReferenceId:data.lastReferenceId,
   lastSource:data.lastSource,lastUpdated:data.lastUpdated,
   mayReadNextPage:false,requiresFreshDbObjectGrant:true,
   requiresCurrentCoreSourceRevision:true});
 }catch{return deny("MALFORMED_QUEUE_CURSOR");}
}
