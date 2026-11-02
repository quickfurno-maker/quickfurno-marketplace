import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("canonical D2-D STOP/START and native Core use identical transactional destination lock",()=>{
 const writer=read("supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql");
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(writer,/pg_advisory_xact_lock\(hashtextextended\('dst\|' \|\| p_destination_hash \|\| '\|' \|\| p_channel, 0\)\)/i);
 assert.match(core,/pg_advisory_xact_lock\(hashtextextended\('dst\|' \|\| \$1::text \|\| '\|whatsapp',0\)\)/);
 const lock=core.indexOf("pg_advisory_xact_lock(hashtextextended(");
 const consent=core.indexOf("const consent=await authorizeConversationalWhatsAppConsent");
 const commit=core.lastIndexOf('db.query("COMMIT")');
 assert.ok(lock>0&&consent>lock&&commit>consent);
 assert.ok(core.includes("readSuppressions:async q=>(await db!.query(suppressions"));
 assert.ok(core.includes("readExactPreference:async q=>(await db!.query(preference"));
 assert.ok(writer.indexOf("pg_advisory_xact_lock(hashtextextended('dst|")<
   writer.indexOf("insert into public.communication_consent_events"));
});
test("Core STOP/START writer is suppression-only; START cannot manufacture marketing consent",()=>{
 const src=read("services/communicationConsentWriterService.ts");
 assert.match(src,/START NEVER creates marketing consent/);
 assert.ok(src.includes('communication_preferences'));
 assert.ok(src.includes('STOP/START are SUPPRESSION-ONLY'));
 const sql=read("supabase/migrations/20260712000300_communication_consent_command_writer_rpc.sql");
 assert.match(sql,/apply_communication_consent_command/);
 assert.match(sql,/communication_suppressions/);
 assert.match(sql,/communication_consent_events/);
 const core=read("services/vox/rc8PgVendorConversationOperator.ts");
 assert.match(core,/RC8_CORE_WRITER_INSTALLED=false/);
});
