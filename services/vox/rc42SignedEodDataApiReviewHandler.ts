import "server-only";
// RC42 EOD: safe HTTP composition of the RC41 PostgREST snapshot and genuine
// RC28 Owner+Team Leader AAL2 / key-revocation / double-snapshot reconciler.
// Read-only, no signature minting, approval, publication or provider message.
type Rpc=(fn:"qf_vox_rc41_signed_eod_review_snapshot_v1",params:{
 p_intent_id:string;p_subject_id:string})=>Promise<{data:unknown;error:unknown}>;
type Result=Readonly<{ok:boolean;state:string;receiptSha256?:string;
 approved:boolean;publicationAuthorized:boolean;providerMessagesSent:number;reason?:string}>;
type Review=(owner:string|null,leader:string|null,input:unknown,rpc:Rpc)=>Promise<Result>;
type Deps={enabled:()=>boolean;installed:()=>boolean;rpc:()=>Rpc|null;review:Review;reviewTimeoutMs?:number};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[a-f0-9]{64}$/;
const KEYS="expectedReceiptSha256|intentId|subjectId";
const send=(value:unknown,status:number)=>Response.json(value,{status,headers:{
 "cache-control":"private, no-store, max-age=0",
 "vary":"Authorization, X-Vox-Team-Leader-Authorization","x-content-type-options":"nosniff"}});
const deny=(error:string,status:number)=>send({ok:false,error,approved:false,
 publicationAuthorized:false,providerMessagesSent:0},status);
export function createRc42SignedEodDataApiReviewHandler(deps:Deps){
 return async function handle(request:Request):Promise<Response>{
  if(!deps.enabled()||!deps.installed())return deny("EOD_ATOMIC_REVIEW_NOT_INSTALLED",503);
  if(request.method!=="GET")return deny("METHOD_NOT_ALLOWED",405);
  const u=new URL(request.url),names=[...u.searchParams.keys()];
  if(u.hash||names.length!==3||new Set(names).size!==3||
    [...names].sort().join("|")!==KEYS)return deny("INVALID_REVIEW_QUERY",400);
  const input={intentId:u.searchParams.get("intentId"),
   subjectId:u.searchParams.get("subjectId"),
   expectedReceiptSha256:u.searchParams.get("expectedReceiptSha256")};
  if(!UUID.test(input.intentId??"")||!UUID.test(input.subjectId??"")||
     !HASH.test(input.expectedReceiptSha256??""))return deny("INVALID_REVIEW_QUERY",400);
  const owner=request.headers.get("authorization");
  const leader=request.headers.get("x-vox-team-leader-authorization");
  if(!owner||!leader||owner===leader)return deny("DISTINCT_OWNER_TL_BEARERS_REQUIRED",403);
  let rpc:Rpc|null;
  try{rpc=deps.rpc();}
  catch{return deny("REVIEWED_DATA_API_READER_UNAVAILABLE",503);}
  if(!rpc)return deny("REVIEWED_DATA_API_READER_UNAVAILABLE",503);
  let reviewTimer:ReturnType<typeof setTimeout>|undefined;
  try{
   // Real review rechecks TWO distinct AAL2 humans before/after the read, then
   // performs the SECOND independent snapshot to reject signer/key/report drift.
   // A stalled Auth or Data API request must never hold the EOD HTTP response
   // indefinitely or be interpreted as an approved signer ceremony.
   const t=deps.reviewTimeoutMs;
   const deadline=Number.isSafeInteger(t)&&Number(t)>=25&&Number(t)<=10000?
    Number(t):6000;
   const checked=await Promise.race([
    deps.review(owner,leader,input,rpc).then(value=>({timedOut:false as const,value})),
    new Promise<{timedOut:true}>(resolve=>{
     reviewTimer=setTimeout(()=>resolve({timedOut:true}),deadline);
    })
   ]);
   if(checked.timedOut)return deny("EOD_REVIEW_TIMEOUT",503);
   const result=checked.value;
   if(!result||result.ok!==true||result.state!=="PENDING_RECEIPT_AWAITING_EXTERNAL_REVIEW"||
      result.approved!==false||result.publicationAuthorized!==false||
      result.providerMessagesSent!==0||!HASH.test(result.receiptSha256??""))
    return deny("EOD_REVIEW_NOT_VERIFIED",409);
   if(result.receiptSha256!==input.expectedReceiptSha256)
    return deny("EOD_RECEIPT_DRIFT",409);
   return send({ok:true,mode:"READ_ONLY",state:result.state,
    receiptSha256:result.receiptSha256,approved:false,publicationAuthorized:false,
    providerMessagesSent:0,requiresIndependentReview:true},200);
  }catch{return deny("EOD_REVIEW_UNAVAILABLE",503);}
  finally{if(reviewTimer!==undefined)clearTimeout(reviewTimer);}
 };
}
