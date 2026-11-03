// VO11 Staff/TL immutable-interval keyset cursor. The cursor carries only
// a timestamp and original UUID nonce; not an identity or authorization grant.
// Keep full Postgres timestamp precision (up to microseconds), never round to ms.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TS=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const exact=(obj,keys)=>obj&&typeof obj==="object"&&!Array.isArray(obj)&&
 Object.keys(obj).sort().join("|")===[...keys].sort().join("|");
const instant=v=>typeof v==="string"&&v.length<=40&&TS.test(v)&&
 Number.isFinite(Date.parse(v));
export function encodeHistoryCursor(row){
 if(!row||!instant(row.ended_at)||typeof row.closed_by_event_nonce!=="string"||
  !UUID.test(row.closed_by_event_nonce))return null;
 return Buffer.from(JSON.stringify({v:1,t:row.ended_at,
  n:row.closed_by_event_nonce.toLowerCase()}),"utf8").toString("base64url");
}
export function decodeHistoryCursor(cursor,nowMs=Date.now()){
 if(typeof cursor!=="string"||cursor.length<35||cursor.length>250||
    !/^[A-Za-z0-9_-]+$/.test(cursor)||!Number.isSafeInteger(nowMs)||
    nowMs<0)return null;
 try{
  const data=Buffer.from(cursor,"base64url");
  if(data.toString("base64url")!==cursor)return null;
  const json=JSON.parse(data.toString("utf8"));
  if(!exact(json,["v","t","n"])||json.v!==1||!instant(json.t)||
     typeof json.n!=="string"||!UUID.test(json.n)||
     json.n!==json.n.toLowerCase()||Date.parse(json.t)>nowMs)
   return null;
  const canonical=encodeHistoryCursor({
   ended_at:json.t,closed_by_event_nonce:json.n
  });
  if(canonical!==cursor)return null;
  return Object.freeze({endedAt:json.t,nonce:json.n});
 }catch{return null;}
}
export function intervalHistoryKeysetFilter(cursor,nowMs=Date.now()){
 const decoded=decodeHistoryCursor(cursor,nowMs);
 if(!decoded)return null;
 // All dynamic values have passed a restricted timestamp/UUID alphabet.
 return `ended_at.lt.${decoded.endedAt},and(ended_at.eq.${decoded.endedAt},closed_by_event_nonce.lt.${decoded.nonce})`;
}
