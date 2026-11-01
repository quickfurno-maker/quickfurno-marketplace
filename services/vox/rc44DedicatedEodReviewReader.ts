import "server-only";
import {createVoxEodSnapshotReaderTransport} from "../../lib/supabase";
import type {Rc41Rpc} from "./rc41SignedEodReviewSnapshot";

// This is an explicit, execute-only PostgREST reader integration, not the
// service-role admin client. The RC41 SQL grants the function ONLY to
// vox_rc41_eod_review_reader after DBA review. The reader has no table DML.
// Source remains disabled at its route until approved identity/SQL gates.
const ROLE="vox_rc41_eod_review_reader";
const JWT=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail=()=>{throw Error("EOD_REVIEW_READER_UNAVAILABLE");};
export type Rc44ReaderInput={
 supabaseUrl?:string|null;anonKey?:string|null;readerJwt?:string|null;
 nowSeconds?:number;clockSeconds?:()=>number
};
/** Returning null can never be treated as a valid reader or substitute
 * adminClient/service_role. JWT claims here are only a local early reject:
 * PostgreSQL/PostgREST MUST verify signature + role; never trust decode alone.
 */
export function createRc44DedicatedEodReviewReader(input:Rc44ReaderInput):Rc41Rpc|null{
 const url=input.supabaseUrl?.trim(),key=input.anonKey?.trim();
 const bearer=input.readerJwt?.trim();
 // An anon JWT is not the dedicated execute-only reviewer. Reject it before
 // constructing even an inert PostgREST transport; never fall back to admin.
 if(!url||!key||!bearer||bearer===key||bearer.length>8192||!JWT.test(bearer))return null;
 let u:URL;
 try {u=new URL(url);}catch{return null;}
 if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash)return null;
 let payload:Record<string,unknown>;
 try{
  const decoded=JSON.parse(Buffer.from(bearer.split(".")[1],"base64url").toString("utf8"));
  if(!decoded||typeof decoded!=="object"||Array.isArray(decoded))return null;
  payload=decoded;
 }catch{return null;}
 const current=input.clockSeconds??(()=>Math.floor(Date.now()/1000));
 const now=input.nowSeconds??current();
 if(payload.role!==ROLE||typeof payload.exp!=="number"||!Number.isSafeInteger(payload.exp)||
    payload.exp<=now||payload.exp>now+3600||payload.aal!==undefined)return null;
 // Do not even construct a PostgREST transport for a token that claims it
 // was issued in the future or is not yet valid. The backend MUST still
 // verify signature and every custom role grant independently.
 if(payload.nbf!==undefined&&(!Number.isSafeInteger(payload.nbf)||
    (payload.nbf as number)>now))return null;
 if(payload.iat!==undefined&&(!Number.isSafeInteger(payload.iat)||
    (payload.iat as number)>now+30))return null;
 // Reject contradictory JWT time claims before any reader creation. A
 // PostgREST signature check is still mandatory and separately enforced.
 if(payload.nbf!==undefined&&Number(payload.nbf)>=Number(payload.exp))return null;
 if(payload.iat!==undefined&&Number(payload.iat)>=Number(payload.exp))return null;
 // A token with an ancient issue time but a future expiry is not a
 // short-lived dedicated reviewer credential. The PostgREST signature gate
 // remains independently mandatory.
 if(payload.iat!==undefined&&now-Number(payload.iat)>3600)return null;
 if(payload.nbf!==undefined&&now-Number(payload.nbf)>3600)return null;
 let transport:ReturnType<typeof createVoxEodSnapshotReaderTransport>;
 try{
  transport=createVoxEodSnapshotReaderTransport({url,anonKey:key,bearer});
 }catch{return null;}
 return async (fn,args)=>{
  if(fn!=="qf_vox_rc41_signed_eod_review_snapshot_v1"||
     !args||!UUID.test(args.p_intent_id)||!UUID.test(args.p_subject_id))fail();
  // A forged clock, future-issued token, or token that is not yet valid
  // cannot initiate or complete a privileged reader request.
  const fresh=()=>{
   const t=current();
   return Number.isSafeInteger(t)&&Number(payload.exp)>t&&
    (payload.nbf===undefined||(Number(payload.nbf)<=t&&
      t-Number(payload.nbf)<=3600))&&
    (payload.iat===undefined||(Number(payload.iat)<=t+30&&
      t-Number(payload.iat)<=3600));
  };
  if(!fresh())fail();
  // Backend validates the signed PostgREST reader JWT. No service-role or
  // privileged fallback, no direct table read and no SQL or EOD mutations.
  try{
   const {data,error}=await transport(fn,{p_intent_id:args.p_intent_id,
    p_subject_id:args.p_subject_id});
   // A JWT expiring while the HTTP read was in flight must never yield
   // a verified pending review snapshot to downstream approval handlers.
   if(!fresh())
    return {data:null,error:{message:"EOD_REVIEW_READER_EXPIRED_DURING_READ"}};
   if(error)return {data:null,error:{message:"EOD_REVIEW_READER_RPC_UNAVAILABLE"}};
   return {data,error:null};
  }catch{return {data:null,error:{message:"EOD_REVIEW_READER_RPC_UNAVAILABLE"}};}
 };
}
