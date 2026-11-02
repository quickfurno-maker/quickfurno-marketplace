/** AB7K identity/attestation release gate. READ-ONLY source analysis.
 * Decides from the ACTUAL SQL text (comments stripped) whether a privileged
 * approval feature has a provable writer. A 64-hex digest column is NOT a
 * cryptographic attestation; no feature is ever authorized by this gate.
 */
import {readFileSync,readdirSync} from "node:fs";
import {join,resolve} from "node:path";
const CANDIDATES="ops/vox/sql-candidates",OVERLAY="ops/vox/identity-attestation-overlay";
const strip=s=>s.replace(/--[^\n]*/g,"");
const list=x=>x.split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
const WRITE=["insert","update","delete"];
const FEATURES=Object.freeze({
 AB7G_EOD_OFFICIAL_RELEASE:{approvalTable:"public.vox_ab7g_eod_owner_approvals_candidate_v1",
  rpc:"public.qf_vox_ab7g_official_eod_publish_candidate_v1"},
 AB7H_SIGNED_OPERATOR:{approvalTable:"public.vox_ab7h_operator_review_candidate_v1",
  rpc:"public.qf_vox_ab7h_signed_operator_atomic_candidate_v1"},
 AB7F_CONVERSATION_OPERATOR:{approvalTable:null,
  rpc:"public.qf_vox_ab7f_conversation_atomic_operator_candidate_v1"},
 AB7F_STAFF_SUSPEND:{approvalTable:"public.vox_ab7i_staff_suspend_approvals_candidate_v1",
  rpc:"public.qf_vox_ab7f_staff_suspend_atomic_candidate_v1"}
});
/** Replays DDL/grant statements in order. Supabase default privileges give
 * service_role ALL on new public tables, so that is the starting assumption. */
export function analyzeSql(files){
 const tables=new Map(),functions=new Map();
 for(const f of files){
  const sql=strip(f.text);
  const events=[];
  for(const m of sql.matchAll(/create table\s+(public\.\w+)/gi))
   events.push({at:m.index,t:"table",name:m[1].toLowerCase()});
  for(const m of sql.matchAll(/create (?:or replace )?function\s+(public\.\w+)\s*\([\s\S]*?\$\$;/gi))
   events.push({at:m.index,t:"fn",name:m[1].toLowerCase(),body:m[0]});
  for(const m of sql.matchAll(/create trigger\s+(\w+)\s+before[\s\S]*?on\s+(public\.\w+)/gi))
   events.push({at:m.index,t:"trigger",name:m[2].toLowerCase(),trigger:m[1]});
  for(const m of sql.matchAll(/(grant|revoke)\s+(execute|all)\s+on function\s+(public\.\w+)\s*\([^)]*\)\s*(to|from)\s+([\w,\s]+?);/gi))
   events.push({at:m.index,t:"fngrant",op:m[1].toLowerCase(),name:m[3].toLowerCase(),roles:list(m[5])});
  for(const m of sql.matchAll(/(grant|revoke)\s+([a-z, ]+?)\s+on\s+(public\.\w+)\s+(to|from)\s+([\w,\s]+?);/gi))
   events.push({at:m.index,t:"tgrant",op:m[1].toLowerCase(),privs:list(m[2]),name:m[3].toLowerCase(),roles:list(m[5])});
  events.sort((a,b)=>a.at-b.at);
  for(const e of events){
   if(e.t==="table")tables.set(e.name,{roles:new Map([["service_role",new Set([...WRITE,"select"])]]),triggers:[]});
   else if(e.t==="trigger")tables.get(e.name)?.triggers.push(e.trigger);
   else if(e.t==="fn"){const prev=functions.get(e.name);
    functions.set(e.name,{body:e.body.toLowerCase(),roles:prev?prev.roles:new Set(["public"])});}
   else if(e.t==="fngrant"){const fn=functions.get(e.name);if(!fn)continue;
    for(const r of e.roles)e.op==="grant"?fn.roles.add(r):fn.roles.delete(r);}
   else{const t=tables.get(e.name);if(!t)continue;
    const p=e.privs.includes("all")?[...WRITE,"select"]:e.privs;
    for(const r of e.roles){const s=t.roles.get(r)??new Set();
     for(const x of p)e.op==="grant"?s.add(x):s.delete(x);t.roles.set(r,s);}}
  }
 }
 return {tables,functions};
}
const roleCan=(t,role,privs)=>privs.some(p=>t?.roles.get(role)?.has(p));
const BROAD=["public","anon","authenticated","service_role"];
function featureReport(name,spec,a){
 const rpc=a.functions.get(spec.rpc),table=spec.approvalTable?a.tables.get(spec.approvalTable):null;
 const writers=spec.approvalTable?[...a.functions].filter(([,f])=>
  f.body.includes("insert into "+spec.approvalTable)):[];
 const provenWriters=writers.filter(([,f])=>{
  const roles=[...f.roles];
  return f.body.includes("auth.uid()")&&/coalesce\(auth\.jwt\(\)->>'aal',''\)<>'aal2'/.test(f.body)&&
   roles.length>0&&roles.every(r=>r==="authenticated");
 }).map(([n])=>n);
 const guarded=!!table?.triggers.includes("ab7k_no_verified_writer_row");
 const rpcCallers=BROAD.filter(r=>rpc?.roles.has(r));
 const reasons=[];
 if(spec.approvalTable&&provenWriters.length===0)reasons.push("NO_PROVEN_NON_SERVICE_ROLE_ATTESTATION_WRITER");
 if(!spec.approvalTable)reasons.push("NO_ATTESTATION_TABLE_OR_WRITER");
 if(rpcCallers.length>0)reasons.push("RPC_EXECUTABLE_BY_"+rpcCallers.join("_").toUpperCase());
 if(table&&roleCan(table,"service_role",WRITE))reasons.push("SERVICE_ROLE_CAN_WRITE_APPROVAL_TABLE");
 if(table&&roleCan(table,"authenticated",WRITE))reasons.push("AUTHENTICATED_CAN_WRITE_APPROVAL_TABLE");
 reasons.push("NO_PINNED_ED25519_VERIFICATION_IN_DATABASE");
 reasons.push("HUMAN_OWNER_TL_AAL2_SIGNOFF_REQUIRED");
 return Object.freeze({feature:name,authorized:false,
  provenAttestationWriters:Object.freeze(provenWriters),
  allWriters:Object.freeze(writers.map(([n])=>n)),
  unconditionalWriteGuard:guarded,rpcExecutableBy:Object.freeze(rpcCallers),
  serviceRoleCanWriteApprovals:!!table&&roleCan(table,"service_role",WRITE),
  reasons:Object.freeze(reasons)});
}
export function evaluateIdentityAttestationSources(files){
 const a=analyzeSql(files);
 const strict=files.some(f=>/ed25519|crypto_sign_verify|verify_signature/i.test(strip(f.text)));
 const serviceRoleWritableLedgers=[...a.tables].filter(([n,t])=>
  /^public\.vox_ab7[fghij]_/.test(n)&&roleCan(t,"service_role",WRITE)).map(([n])=>n).sort();
 return Object.freeze({ok:true,authorized:false,releaseReady:false,
  databaseEd25519Verification:strict,serviceRoleWritableLedgers:Object.freeze(serviceRoleWritableLedgers),
  features:Object.freeze(Object.fromEntries(Object.entries(FEATURES).map(
   ([n,s])=>[n,featureReport(n,s,a)])))});
}
export function readIdentityAttestationSources(repoRoot,{includeOverlay=true}={}){
 const read=dir=>readdirSync(resolve(repoRoot,dir)).filter(n=>/^\d{14}_[\w-]+\.sql$/.test(n)).sort()
  .map(n=>({name:n,text:readFileSync(join(resolve(repoRoot,dir),n),"utf8")}));
 const candidates=read(CANDIDATES).filter(f=>/_vox_ab7[bfghj]_/.test(f.name)||/ab7[fghj]/.test(f.name));
 return includeOverlay?[...candidates,...read(OVERLAY)]:candidates;
}
export function inspectAb7kIdentityAttestationGate(repoRoot,options){
 try{
  if(typeof repoRoot!=="string"||!repoRoot)throw Error("INVALID_ROOT");
  return evaluateIdentityAttestationSources(readIdentityAttestationSources(repoRoot,options));
 }catch(e){return Object.freeze({ok:false,authorized:false,releaseReady:false,
  reason:e instanceof Error?e.message:"UNKNOWN_SOURCE_FAILURE"});}
}
