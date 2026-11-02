/**
 * VOX-F1 authoritative Core-backed four-source EOD reader.
 * Source-only until the independently reviewed *append-only* event and
 * watermark schema is installed. Never reads un-attributed legacy messages.
 * Requires existing authenticated AAL2 scope, exact active object grants,
 * and per-source HMAC issued by the trusted Core event recorder.
 */
import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import {previewAttributableFourSourceEod,requiredAttributableSources}
 from "./l9FourSourceEodEvidence.mjs";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const KEY=/^[a-f0-9]{64}$/i;
const err=(reason)=>Object.freeze({ok:false,reason,mode:"READ_ONLY",
  completeness:"NOT_CERTIFIED",rollup:null,canSubmit:false,
  providerMessagesSent:0});
const ts=x=>typeof x==="string"&&Number.isFinite(Date.parse(x));
const exact=(x,keys)=>!!x&&typeof x==="object"&&!Array.isArray(x)&&
 Object.keys(x).sort().join("|")===keys.slice().sort().join("|");
const EVENT=["id","source","actor_id","team_id","city_id","object_id",
 "revision","event_kind","occurred_at","subject_kind","subject_id"];
const MARK=["source","actor_id","team_id","city_id","business_date",
 "cursor_start","cursor_end","event_checksum","signed_at","signature"];
const normal=(x)=>({
 id:x.id,source:x.source,actorId:x.actor_id,teamId:x.team_id,
 cityId:x.city_id,objectId:x.object_id,revision:x.revision,
 kind:x.event_kind,occurredAtMs:Date.parse(x.occurred_at),
 subjectKind:x.subject_kind,subjectId:x.subject_id});
export function sourceEventChecksum(events){
 if(!Array.isArray(events))throw Error("INVALID_EVENTS");
 return createHash("sha256").update(JSON.stringify(
  events.map(normal).sort((a,b)=>a.id.localeCompare(b.id))
 )).digest("hex");
}
export function signEodReaderWatermark({row,secret}){
 if(typeof secret!=="string"||secret.length<32)throw Error("BAD_SIGNER_KEY");
 const canonical=[row.source,row.actor_id,row.team_id,row.city_id,
  row.business_date,row.cursor_start,row.cursor_end,row.event_checksum,
  row.signed_at].join("|");
 return createHmac("sha256",secret).update(canonical).digest("hex");
}
export async function readCertifiedFourSourceEod({
 db,scope,businessDate,secret,verifyCurrentScope,verifyExactObjectGrant,
 now=Date.now()
}={}){
 if(!db||typeof db.from!=="function"||!scope||!ID.test(scope.userId)||
  !ID.test(scope.teamId)||!ID.test(scope.cityId)||
  scope.currentAal!=="aal2"||scope.canReadContent!==true||
  scope.canMutate!==false||!DATE.test(businessDate??"")||
  typeof secret!=="string"||secret.length<32||
  typeof verifyCurrentScope!=="function"||
  typeof verifyExactObjectGrant!=="function"||
  !Number.isSafeInteger(now)||now<=0)return err("EOD_TRUSTED_CORE_CONTEXT_REQUIRED");
 const startMs=Date.parse(businessDate+"T00:00:00+05:30");
 const endMs=startMs+86400000;
 // An official full-day source watermark cannot attest events in the future.
 if(endMs>now)return err("IST_BUSINESS_DAY_NOT_CLOSED");
 if(!Number.isFinite(startMs)||endMs<=startMs||
  new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Kolkata",
   year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(startMs))!==businessDate)
  return err("BAD_IST_WINDOW");
 try{
  if((await verifyCurrentScope(scope))!==true)return err("STAFF_REVOKED");
  // No browser data and no unchecked truncation: 1,001 is intentionally
  // an OVERFLOW sentinel, not a hidden pagination shortcut.
  const [events,marks]=await Promise.all([
   db.from("vox_staff_source_events_candidate_v1").select(EVENT.join(","))
    .eq("actor_id",scope.userId).eq("team_id",scope.teamId)
    .eq("city_id",scope.cityId)
    .gte("occurred_at",new Date(startMs).toISOString())
    .lt("occurred_at",new Date(endMs).toISOString()).limit(1001),
   db.from("vox_staff_source_watermarks_candidate_v1").select(MARK.join(","))
    .eq("actor_id",scope.userId).eq("team_id",scope.teamId)
    .eq("city_id",scope.cityId).eq("business_date",businessDate).limit(5)
  ]);
  if(events.error||marks.error||!Array.isArray(events.data)||
   !Array.isArray(marks.data)||events.data.length>1000||
   marks.data.length!==4)return err("SOURCE_DATABASE_OR_WATERMARK_INCOMPLETE");
  const bySource=new Map(requiredAttributableSources.map(s=>[s,[]]));
  for(const e of events.data){
   if(!exact(e,EVENT)||!bySource.has(e.source)||!ID.test(e.id)||
    !ID.test(e.actor_id)||!ID.test(e.team_id)||!ID.test(e.city_id)||
    !ID.test(e.object_id)||!ID.test(e.subject_id)||
    !["prospect","vendor","support_thread","conversation"].includes(e.subject_kind)||
    e.actor_id!==scope.userId||e.team_id!==scope.teamId||
    e.city_id!==scope.cityId||!Number.isSafeInteger(e.revision)||
    e.revision<0||!ts(e.occurred_at))return err("UNVERIFIED_ATTRIBUTABLE_EVENT");
   if((await verifyExactObjectGrant({
    actorId:scope.userId,teamId:scope.teamId,cityId:scope.cityId,
    source:e.source,subjectKind:e.subject_kind,subjectId:e.subject_id,
    occurredAt:e.occurred_at}))!==true)return err("OBJECT_SCOPE_REVOKED");
   bySource.get(e.source).push(e);
  }
  const seen=new Set(),readings=[];
  for(const m of marks.data){
   if(!exact(m,MARK)||!bySource.has(m.source)||seen.has(m.source)||
    m.actor_id!==scope.userId||m.team_id!==scope.teamId||
    m.city_id!==scope.cityId||m.business_date!==businessDate||
    !ts(m.cursor_start)||!ts(m.cursor_end)||!ts(m.signed_at)||
    !KEY.test(m.signature)||!KEY.test(m.event_checksum)||
    Date.parse(m.cursor_start)>startMs||
    Date.parse(m.cursor_end)<endMs||
    Date.parse(m.signed_at)<endMs||
    Date.parse(m.signed_at)>now+30000||
    Date.parse(m.signed_at)<now-300000)
    return err("SOURCE_WATERMARK_NOT_CURRENT");
   const list=bySource.get(m.source);
   if(sourceEventChecksum(list)!==m.event_checksum)
    return err("SOURCE_EVENT_CHECKSUM_MISMATCH");
   const expected=Buffer.from(signEodReaderWatermark({row:m,secret}),"hex");
   const given=Buffer.from(m.signature,"hex");
   if(given.length!==expected.length||!timingSafeEqual(given,expected))
    return err("SOURCE_SIGNATURE_DENIED");
   seen.add(m.source);
   readings.push({source:m.source,cursorStartMs:Date.parse(m.cursor_start),
    cursorEndMs:Date.parse(m.cursor_end),events:list.map(normal)});
  }
  if(seen.size!==4)return err("FOUR_SOURCES_INCOMPLETE");
  const projection=await previewAttributableFourSourceEod({
   scope,businessDate,window:{startMs,endMs},readings,
   verifyReading:async()=>true,
   verifyCurrentScope
  });
  if(!projection.ok)return projection;
  return Object.freeze({...projection,
   proof:"CORE_HMAC_SIGNED_DB_WATERMARKS_AND_LIVE_GRANTS",
   // Human-certified official submit remains a separate reviewed SQL action.
   canSubmit:false,canExport:false});
 }catch{return err("SOURCE_READ_OR_VERIFICATION_UNAVAILABLE");}
}
