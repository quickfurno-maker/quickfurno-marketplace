import "server-only";
import {createClient,type SupabaseClient} from "@supabase/supabase-js";
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
 nowSeconds?:number
};
/** Returning null can never be treated as a valid reader or substitute
 * adminClient/service_role. JWT claims here are only a local early reject:
 * PostgreSQL/PostgREST MUST verify signature + role; never trust decode alone.
 */
export function createRc44DedicatedEodReviewReader(input:Rc44ReaderInput):Rc41Rpc|null{
 const url=input.supabaseUrl?.trim(),key=input.anonKey?.trim();
 const bearer=input.readerJwt?.trim();
 if(!url||!key||!bearer||bearer.length>8192||!JWT.test(bearer))return null;
 let u:URL;
 try {u=new URL(url);}catch{return null;}
 if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash)return null;
 let payload:Record<string,unknown>;
 try{
  const decoded=JSON.parse(Buffer.from(bearer.split(".")[1],"base64url").toString("utf8"));
  if(!decoded||typeof decoded!=="object"||Array.isArray(decoded))return null;
  payload=decoded;
 }catch{return null;}
 const now=input.nowSeconds??Math.floor(Date.now()/1000);
 if(payload.role!==ROLE||typeof payload.exp!=="number"||!Number.isSafeInteger(payload.exp)||
    payload.exp<=now||payload.exp>now+3600||payload.aal!==undefined)return null;
 let client:SupabaseClient;
 try{
  client=createClient(url,key,{
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
   global:{headers:{Authorization:"Bearer "+bearer}}
  });
 }catch{return null;}
 return async (fn,args)=>{
  if(fn!=="qf_vox_rc41_signed_eod_review_snapshot_v1"||
     !args||!UUID.test(args.p_intent_id)||!UUID.test(args.p_subject_id))fail();
  if(Number(payload.exp)<=Math.floor(Date.now()/1000))fail();
  // Backend validates the signed PostgREST reader JWT. No service-role or
  // privileged fallback, no direct table read and no SQL or EOD mutations.
  try{
   const {data,error}=await client.rpc(fn,{p_intent_id:args.p_intent_id,
    p_subject_id:args.p_subject_id});
   if(error)return {data:null,error:{message:"EOD_REVIEW_READER_RPC_UNAVAILABLE"}};
   return {data,error:null};
  }catch{return {data:null,error:{message:"EOD_REVIEW_READER_RPC_UNAVAILABLE"}};}
 };
}
