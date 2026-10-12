import { NextResponse } from 'next/server';
import { ANISHA_PURGE_PROTOCOL, ANISHA_PURGE_CLAIM_PATH, ANISHA_PURGE_CLAIM_DOMAIN, parseAnishaPurgeClaim } from '@/lib/jarvis/anishaMemoryPurgeContract';
import { verifyAnishaMemoryPurgeRequest } from '@/lib/jarvis/anishaMemoryPurgeAuth';
import { claimAnishaMemoryPurges } from '@/services/anishaMemoryPurgeService';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (status: number, body: unknown) => NextResponse.json(body, {status,headers:{'cache-control':'no-store'}});
export async function POST(request:Request):Promise<Response>{
  const raw=new Uint8Array(await request.arrayBuffer().catch(()=>new ArrayBuffer(0)));
  if(raw.length<2||raw.length>2048)return reply(400,{error:'invalid_request'});
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.from(raw).toString('utf8'));}catch{return reply(400,{error:'invalid_request'});}
  const input=parseAnishaPurgeClaim(parsed);
  if(!input)return reply(400,{error:'invalid_request'});
  const signed=verifyAnishaMemoryPurgeRequest({raw,request,domain:ANISHA_PURGE_CLAIM_DOMAIN,path:ANISHA_PURGE_CLAIM_PATH,requestId:input.requestId,issuedAt:input.issuedAt});
  if(!signed)return reply(401,{error:'authentication_failed'});
  const result=await claimAnishaMemoryPurges(input);
  if(!result.ok)return reply(503,{error:'unavailable'});
  return reply(200,{protocol:ANISHA_PURGE_PROTOCOL,version:1,action:'CLAIM',requestId:input.requestId,tasks:result.value});
}
