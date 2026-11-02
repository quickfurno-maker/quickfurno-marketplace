import "server-only";
import {rc8EvaluateReceiptEvidence} from "../../scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs";
import {verifyRc28PendingEodWithReconciler} from "./rc28PendingSignedEodReview";

// RC41 review-only Data API reader for the signed-EOD pending receipt. It calls
// ONE PostgREST RPC (one statement, one snapshot) that the caller injects, so
// this module owns no client, no credential, no connection string and no pool.
// It is NOT wired into rc38SignedEodReviewDb (that source stays hard-off) and
// installing it needs the independent DBA/AppSec + Owner GO for the RC41 SQL.
// Decisions are taken by rc8EvaluateReceiptEvidence, the same code the pg
// reconciler uses; this file only validates the snapshot's shape. It can never
// approve, publish, write, or send a provider message.
export const RC41_SIGNED_EOD_REVIEW_RPC_INSTALLED=false as const;
export const RC41_SNAPSHOT_FUNCTION="qf_vox_rc41_signed_eod_review_snapshot_v1";
export type Rc41Rpc=(fn:typeof RC41_SNAPSHOT_FUNCTION,
 args:{p_intent_id:string;p_subject_id:string})=>Promise<{data:unknown;error:unknown}>;
type Rec=Record<string,unknown>;
const SCHEMA="qf.vox.rc41.signed-eod-review-snapshot.v1";
const MAX_INTENTS=1,MAX_CLAIMS=4,MAX_SUBJECT_INTENTS=3,MAX_KEYS=3;
// Fields that must never be accepted from the database even if a bad function returns them.
const FORBIDDEN=/private|secret|pem|token|password|session/i;
const bad=()=>{throw Error("RC41_SNAPSHOT_MALFORMED")};
const rec=(x:unknown):Rec=>(x&&typeof x==="object"&&!Array.isArray(x)?x as Rec:bad());
const arr=(x:unknown,max:number):unknown[]=>(Array.isArray(x)&&x.length<=max?x:bad());
const exact=(o:Rec,keys:string[])=>{
 if(Object.keys(o).sort().join("|")!==[...keys].sort().join("|"))bad();
 for(const k of Object.keys(o))if(FORBIDDEN.test(k))bad();
 return o;
};
const str=(x:unknown)=>typeof x==="string"?x:bad();
const bool=(x:unknown)=>typeof x==="boolean"?x:bad();
const int=(x:unknown)=>typeof x==="number"&&Number.isSafeInteger(x)?x:bad();
function parseSnapshot(data:unknown){
 const s=exact(rec(data),["schema","serverNowMs","intents","claims","subjectIntentIds",
  "report","keys","attestations"]);
 if(s.schema!==SCHEMA)bad();
 const intents=arr(s.intents,MAX_INTENTS).map(x=>{
  const o=exact(rec(x),["id","type","subjectId","digest","teamId","cityId","ownerId",
   "teamLeaderId","verifiedSignaturePair","state"]);
  return {id:str(o.id),type:str(o.type),subjectId:str(o.subjectId),digest:str(o.digest),
   teamId:str(o.teamId),cityId:str(o.cityId),ownerId:str(o.ownerId),
   teamLeaderId:str(o.teamLeaderId),verifiedSignaturePair:bool(o.verifiedSignaturePair),
   state:str(o.state)};
 });
 const claims=arr(s.claims,MAX_CLAIMS).map(x=>{
  const o=exact(rec(x),["claimKind","claimKey"]);
  return {claimKind:str(o.claimKind),claimKey:str(o.claimKey)};
 });
 const subjectIntentIds=arr(s.subjectIntentIds,MAX_SUBJECT_INTENTS).map(str);
 const report=s.report===null?null:(()=>{
  const o=exact(rec(s.report),["teamId","cityId","staffId","reviewerId","sourceCount",
   "sourceDigest","state","published"]);
  return {teamId:str(o.teamId),cityId:str(o.cityId),staffId:str(o.staffId),
   reviewerId:str(o.reviewerId),sourceCount:int(o.sourceCount),
   sourceDigest:str(o.sourceDigest),state:str(o.state),published:bool(o.published)};
 })();
 const keys=arr(s.keys,MAX_KEYS).map(x=>{
  const o=exact(rec(x),["keyId","signerId","signerRole","revoked","registryMatches",
   "notBeforeMs","notAfterMs"]);
  return {keyId:str(o.keyId),signerId:str(o.signerId),signerRole:str(o.signerRole),
   revoked:bool(o.revoked),registryMatches:bool(o.registryMatches),
   notBeforeMs:int(o.notBeforeMs),notAfterMs:int(o.notAfterMs)};
 });
 const side=(x:unknown)=>{
  const o=exact(rec(x),["userId","authorityCurrent","aal2Current"]);
  return {userId:str(o.userId),authorityCurrent:bool(o.authorityCurrent),aal2Current:bool(o.aal2Current)};
 };
 // null (no receipt => no humans to attest) stays null, never undefined, so the
 // evaluator treats it as missing attestations instead of skipping the check.
 const attestations=s.attestations===null?null:(()=>{
  const o=exact(rec(s.attestations),["owner","teamLeader"]);
  return {owner:side(o.owner),teamLeader:side(o.teamLeader)};
 })();
 return {serverNowMs:int(s.serverNowMs),intents,claims,subjectIntentIds,report,keys,attestations};
}
/** Same result contract as reconcileRc8PgSignedIntentOutcome. Any RPC error,
 * transport failure or malformed snapshot THROWS so callers fail closed. */
export async function rc41ReconcileSignedEodReceiptViaRpc(rpc:Rc41Rpc,
 input:{intentId:string;subjectId:string;expectedReceiptSha256:string}){
 if(typeof rpc!=="function")throw Error("RC41_RPC_REQUIRED");
 const {data,error}=await rpc(RC41_SNAPSHOT_FUNCTION,
  {p_intent_id:input.intentId,p_subject_id:input.subjectId});
 if(error)throw Error("RC41_RPC_FAILED");
 const s=parseSnapshot(data);
 return rc8EvaluateReceiptEvidence({intentId:input.intentId,subjectId:input.subjectId,
  expectedReceiptSha256:input.expectedReceiptSha256,now:s.serverNowMs,
  durable:{intents:s.intents,claims:s.claims},subjectIntentIds:s.subjectIntentIds,
  report:s.report,keys:s.keys,attestations:s.attestations,allowNotCommitted:false});
}
/** The RC28 Owner+TL review flow with the RC41 RPC as its only evidence source. */
export function verifyRc41PendingEodViaRpc(ownerAuthorization:string|null,
 leaderAuthorization:string|null,input:unknown,rpc:Rc41Rpc){
 return verifyRc28PendingEodWithReconciler(ownerAuthorization,leaderAuthorization,input,
  args=>rc41ReconcileSignedEodReceiptViaRpc(rpc,args));
}
