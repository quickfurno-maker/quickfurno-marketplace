import "server-only";
import crypto from "crypto";
import { adminClient } from "@/lib/supabase";

const TOKEN=/^[A-Za-z0-9_-]{32,128}$/;
const DEFAULT_TTL_MS=7*24*60*60*1000;

function tokenHash(token:string):string{
  return crypto.createHash("sha256").update(token,"utf8").digest("hex");
}

export type AarohiRegistrationIntent = Readonly<{
  intentId:string;
  prospectId:string;
  channel:"WHATSAPP"|"INSTAGRAM"|"FACEBOOK"|"X"|"WEBSITE"|"MANUAL";
  expiresAt:string;
}>;

export async function createAarohiRegistrationIntent(args:{
  prospectId:string;
  channel:AarohiRegistrationIntent["channel"];
  ttlMs?:number;
}):Promise<{ok:true;token:string;intent:AarohiRegistrationIntent}|{ok:false;reason:string}>{
  const db=adminClient();
  const {data:prospect,error}=await db.from("aarohi_prospects")
    .select("id,tenant_id,do_not_contact,ai_paused,human_takeover,merged_into_prospect_id,prospect_stage")
    .eq("id",args.prospectId).eq("tenant_id","quickfurno").maybeSingle();
  if(error) return {ok:false,reason:"core_unavailable"};
  if(!prospect||prospect.do_not_contact||prospect.merged_into_prospect_id||prospect.prospect_stage==="SUPPRESSED"){
    return {ok:false,reason:"prospect_not_convertible"};
  }
  const ttl=args.ttlMs??DEFAULT_TTL_MS;
  if(!Number.isFinite(ttl)||ttl<60_000||ttl>30*24*60*60*1000){
    return {ok:false,reason:"invalid_ttl"};
  }
  const token=crypto.randomBytes(32).toString("base64url");
  const expiresAt=new Date(Date.now()+ttl).toISOString();
  const inserted=await db.from("aarohi_registration_intents").insert({
    prospect_id:args.prospectId,
    token_hash:tokenHash(token),
    channel:args.channel,
    expires_at:expiresAt,
  }).select("id,prospect_id,channel,expires_at").single();
  if(inserted.error||!inserted.data) return {ok:false,reason:"intent_create_failed"};
  return {
    ok:true,
    token,
    intent:Object.freeze({
      intentId:String(inserted.data.id),
      prospectId:String(inserted.data.prospect_id),
      channel:inserted.data.channel as AarohiRegistrationIntent["channel"],
      expiresAt:String(inserted.data.expires_at),
    }),
  };
}

export async function resolveAarohiRegistrationIntent(token:string):Promise<
  {ok:true;intent:AarohiRegistrationIntent}|{ok:false;reason:string}
>{
  if(typeof token!=="string"||!TOKEN.test(token)) return {ok:false,reason:"invalid_token"};
  const db=adminClient();
  const {data,error}=await db.from("aarohi_registration_intents")
    .select("id,prospect_id,channel,expires_at,consumed_at,vendor_id")
    .eq("token_hash",tokenHash(token)).maybeSingle();
  if(error) return {ok:false,reason:"core_unavailable"};
  if(!data) return {ok:false,reason:"invalid_token"};
  if(data.consumed_at||data.vendor_id) return {ok:false,reason:"token_consumed"};
  if(Date.parse(String(data.expires_at))<=Date.now()) return {ok:false,reason:"token_expired"};

  const prospect=await db.from("aarohi_prospects")
    .select("id,do_not_contact,merged_into_prospect_id,prospect_stage")
    .eq("id",String(data.prospect_id)).eq("tenant_id","quickfurno").maybeSingle();
  if(prospect.error) return {ok:false,reason:"core_unavailable"};
  if(!prospect.data||prospect.data.do_not_contact||prospect.data.merged_into_prospect_id||prospect.data.prospect_stage==="SUPPRESSED"){
    return {ok:false,reason:"prospect_not_convertible"};
  }
  return {
    ok:true,
    intent:Object.freeze({
      intentId:String(data.id),
      prospectId:String(data.prospect_id),
      channel:data.channel as AarohiRegistrationIntent["channel"],
      expiresAt:String(data.expires_at),
    }),
  };
}

export async function consumeAarohiRegistrationIntent(args:{
  token:string;
  vendorId:string;
}):Promise<{ok:true;correlationId:string}|{ok:false;reason:string}>{
  const resolved=await resolveAarohiRegistrationIntent(args.token);
  if(!resolved.ok) return resolved;
  const db=adminClient();
  const {data,error}=await db.rpc("qf_aarohi_link_vendor_conversion_v1" as never,{
    p_prospect_id:resolved.intent.prospectId,
    p_vendor_id:args.vendorId,
    p_registration_intent_id:resolved.intent.intentId,
    p_source_reference:`registration-intent:${resolved.intent.intentId}`,
  } as never);
  if(error||!data) return {ok:false,reason:"correlation_failed"};
  const row=(Array.isArray(data)?data[0]:data) as {id?:unknown}|null;
  const id=row?.id;
  return typeof id==="string"?{ok:true,correlationId:id}:{ok:false,reason:"correlation_failed"};
}
