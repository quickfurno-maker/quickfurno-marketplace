// RC7 Track B: source mutation-surface inventory. Fail on unexpected SQL paths.
// This never proves production serialization; any new mutator requires a new audit.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=resolve(root,"supabase/migrations");
const files=readdirSync(source).filter(f=>f.endsWith(".sql")).sort();
const ddl=files.map(f=>({file:f,text:readFileSync(resolve(source,f),"utf8")}));
const MUTATION=/\b(?:insert\s+into|update|delete\s+from)\s+public\.(communication_suppressions|communication_preferences)\b/gi;
function writeSites(){
 const sites=[];
 for(const {file,text} of ddl){let m;while((m=MUTATION.exec(text))!==null){
  const lineno=text.slice(0,m.index).split("\n").length;
  sites.push({file,relation:m[1],line:lineno});
 }}
 return sites;
}
test("only reviewed D2-D or marketing source migrations mutate consent authority tables",()=>{
 const sites=writeSites();
 assert.equal(sites.length,4,JSON.stringify(sites));
 const suppression=sites.filter(x=>x.relation==="communication_suppressions");
 assert.equal(suppression.length,3);
 for(const x of suppression)assert.equal(x.file,"20260712000300_communication_consent_command_writer_rpc.sql");
 const preference=sites.filter(x=>x.relation==="communication_preferences");
 assert.equal(preference.length,1);
 assert.equal(preference[0].file,"20260814000000_qf_mvp_40_marketing_consent_writer.sql");
});
test("D2-D destination lock is ordered before all currently inventoried suppression writes",()=>{
 const d2d=ddl.find(x=>x.file==="20260712000300_communication_consent_command_writer_rpc.sql").text;
 const lock=d2d.indexOf("pg_advisory_xact_lock(hashtextextended('dst|' || p_destination_hash || '|' || p_channel, 0))");
 assert.ok(lock>0);
 for(const fragment of ["update public.communication_suppressions","insert into public.communication_suppressions"])
  assert.ok(d2d.indexOf(fragment)>lock,fragment);
});
test("marketing preference writer is principal-only, not transactional or a destination-lock proof",()=>{
 const m=ddl.find(x=>x.file==="20260814000000_qf_mvp_40_marketing_consent_writer.sql").text;
 assert.match(m,/where\s+principal_type\s+=\s+p_principal_type/);
 assert.match(m,/scope\s*=\s*'marketing'/);
 assert.match(m,/p_action\s+is\s+null/);
 assert.doesNotMatch(m,/pg_advisory_xact_lock\(hashtextextended\('dst\|'/);
 // Never conclude that a principal-only marketing RPC proves destination locking.
});
test("native CORE_CONVERSATION SQL restriction and source release flag remain hard-off",()=>{
 const sql=readFileSync(resolve(root,"ops/vox/sql-candidates/20261018020000_vox_ab7b_nonwork_native_source_candidate.sql"),"utf8");
 const binding=readFileSync(resolve(root,"contracts/vox/rc4ConversationAuthorization.mjs"),"utf8");
 assert.match(sql,/constraint vox_ab7b_core_conversation_blocked check\(source<>'CORE_CONVERSATION'\)/);
 assert.match(binding,/bindingSignedOff:false/);
 assert.match(binding,/consentWritersSerialized:false/);
});
