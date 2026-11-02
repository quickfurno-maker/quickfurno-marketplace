import "server-only";
import {verifyRc28PendingEodForHumanReview} from "./rc28PendingSignedEodReview";

// RC38 read-only Owner + Team Leader signed-EOD review. GET only: it reads the
// durable pending receipt through the RC28 service (two real AAL2 bearers, RC8
// reconciler, RC37 stored signer keys, double snapshot). It never approves,
// publishes, signs, writes, or sends a provider message.
type Db={query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;release:(destroy?:boolean)=>void};
export type Rc38Deps={
 enabled:()=>boolean;
 dbSource:()=>(()=>Promise<Db>)|null;
 review:typeof verifyRc28PendingEodForHumanReview;
};
const KEYS="expectedReceiptSha256|intentId|subjectId";
const OWNER_HEADER="authorization";
const LEADER_HEADER="x-vox-team-leader-authorization";
const send=(v:unknown,status:number)=>Response.json(v,{status,headers:{
 "cache-control":"private, no-store, max-age=0","vary":"Authorization, X-Vox-Team-Leader-Authorization",
 "x-content-type-options":"nosniff"
}});
const AUTH_DENIALS=new Set(["DISTINCT_OWNER_AND_TL_AAL2_REQUIRED",
 "REVIEWER_NOT_RECEIPT_SIGNER_SCOPE","HUMAN_AAL2_REVOKED_DURING_RECONCILIATION"]);
const UNAVAILABLE=new Set(["HUMAN_AAL2_VERIFICATION_UNAVAILABLE",
 "HUMAN_AAL2_RECHECK_UNAVAILABLE","SIGNER_RECEIPT_RECONCILIATION_UNAVAILABLE",
 "SIGNER_RECEIPT_FINAL_RECONCILIATION_UNAVAILABLE"]);
export async function handleRc38SignedEodReview(request:Request,deps:Rc38Deps){
 if(!deps.enabled())return send({ok:false,error:"SIGNED_EOD_REVIEW_DISABLED"},503);
 const params=new URL(request.url).searchParams;
 const names=[...params.keys()];
 if(names.length!==3||new Set(names).size!==3||[...names].sort().join("|")!==KEYS)
  return send({ok:false,error:"INVALID_REVIEW_QUERY"},400);
 const input={intentId:params.get("intentId"),subjectId:params.get("subjectId"),
  expectedReceiptSha256:params.get("expectedReceiptSha256")};
 const owner=request.headers.get(OWNER_HEADER);
 const leader=request.headers.get(LEADER_HEADER);
 // Two distinct credentials are mandatory; one bearer can never act as both.
 if(!owner||!leader||owner===leader)
  return send({ok:false,error:"DISTINCT_OWNER_AND_TL_BEARERS_REQUIRED"},403);
 const acquire=deps.dbSource();
 if(!acquire)return send({ok:false,error:"SIGNED_EOD_REVIEW_DB_SOURCE_UNAVAILABLE"},503);
 let r;
 try{r=await deps.review(owner,leader,input,acquire)}
 catch{return send({ok:false,error:"SIGNED_EOD_REVIEW_UNAVAILABLE"},503)}
 if(r.ok===true&&"receiptSha256" in r&&r.state==="PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW"&&
    r.approved===false&&r.publicationAuthorized===false)
  return send({ok:true,schema:"qf.vox.eod.signed-review.v1",mode:"READ_ONLY",
   state:r.state,receiptSha256:r.receiptSha256,approved:false,
   publicationAuthorized:false,requiresIndependentReview:true,
   providerMessagesSent:0},200);
 const reason=(r as {reason?:string}).reason??"";
 const status=reason==="SIGNED_INTENT_INPUT_INVALID"?400:
  AUTH_DENIALS.has(reason)?403:UNAVAILABLE.has(reason)?503:409;
 return send({ok:false,error:status===409?"SIGNED_EOD_REVIEW_DENIED":reason||"SIGNED_EOD_REVIEW_DENIED",
  reason:status===409?"HOLD":undefined,approved:false,publicationAuthorized:false,
  providerMessagesSent:0},status);
}
