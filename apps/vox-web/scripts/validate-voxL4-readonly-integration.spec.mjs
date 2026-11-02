import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL(p,import.meta.url),"utf8");
const bff=read("../lib/clientSourceStatus.ts");
const staff=read("../app/team/command-center/page.tsx");
const client=read("../app/team/client-cases/page.tsx");
const eod=read("../app/team/eod-sources/page.tsx");
test("new client and EOD data are fetched only in pinned, server-only, MFA Core BFF",()=>{
 assert.match(bff,/import "server-only"/);
 assert.match(bff,/verifiedMfaSession/);assert.match(bff,/origin\(\)/);
 assert.match(bff,/cache:"no-store"/);assert.match(bff,/redirect:"error"/);
 assert.match(bff,/VOX_RIYA_CASES_UI_ENABLED/);
 assert.match(bff,/VOX_EOD_SOURCE_STATUS_UI_ENABLED/);
});
test("BFF rejects unknown schema, provider sends, transcripts and fake complete EOD",()=>{
 assert.match(bff,/exact\(v,/);
 assert.match(bff,/v\.canSendReply!==false/);
 assert.match(bff,/v\.providerMessagesSent!==0/);
 assert.match(bff,/v\.rollup!==null/);
 assert.match(bff,/v\.allSourceReady!==false/);
 assert.match(bff,/v\.completeness!=="INCOMPLETE_NO_SIGNED_ALL_SOURCE_WATERMARKS"/);
});
test("command center displays two extra independently locked protected paths",()=>{
 for(const path of ["/team/client-cases","/team/eod-sources"]){
  assert.equal(staff.includes(path),true);
 }
 assert.match(staff,/Promise\.all/);
 assert.match(staff,/fetchScopedRiyaClientCases/);
 assert.match(staff,/fetchStaffSourceReadiness/);
});
test("Riya does not expose WhatsApp, pause, provider or reply actions",()=>{
 assert.match(client,/No transcript, reply or takeover authority/);
 assert.match(client,/disabled/);
 assert.doesNotMatch(client,/sendWhatsApp\(|sendReply\(|unpauseRiya\(|approveTakeover\(/);
});
test("EOD never claims signed multi-source total or official submission",()=>{
 assert.match(eod,/Final all-source total unavailable/);
 assert.match(eod,/No missing data is treated as zero/);
 assert.match(eod,/disabled here/);
});
test("no browser-owned Supabase service role, token or new authentication",()=>{
 const combined=bff+staff+client+eod;
 assert.doesNotMatch(combined,/NEXT_PUBLIC_.*SERVICE_ROLE|createAdminClient\(|signUp\(/);
});
