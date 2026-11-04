import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {spawnSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {
 validatePrivateScanCandidate,parsePrivateClamavResponse,
 scanPrivateDocumentWithLocalClamav,MAX_PRIVATE_SCAN_BYTES,
} from "../../../lib/vendors/privateClamavScanner.mjs";

const uuid="10000000-0000-4000-8000-000000000007";
const good={
 evidenceId:"70000000-0000-4000-8000-000000000007",
 caseId:"80000000-0000-4000-8000-000000000007",
 vendorId:uuid,caseVersion:1,
 storageKey:`vendors/${uuid}/90000000-0000-4000-8000-000000000007.pdf`,
 sha256:"a".repeat(64),
};

test("B8-1 scanner queue objects are exact, purpose-bound and opaque",()=>{
 assert.equal(validatePrivateScanCandidate(good),true);
 for(const bad of [
 {...good,storageKey:"https://public.example/path.pdf"},
 {...good,storageKey:`vendors/${uuid}/../../identity.pdf`},
 {...good,storageKey:good.storageKey.replace(uuid,"10000000-0000-4000-8000-000000000008")},
 {...good,caseVersion:0},
 {...good,sha256:"g".repeat(64)},
 {...good,verified:true},
 ])assert.equal(validatePrivateScanCandidate(bad),false);
});

test("B8-2 only genuine clamd stream OK or FOUND are settled; errors fail closed",()=>{
 assert.equal(parsePrivateClamavResponse("stream: OK\0"),"clean");
 assert.equal(parsePrivateClamavResponse("stream: Eicar-Test-Signature FOUND\0"),"infected");
 for(const input of ["OK","stream: ERROR","stream: some ERROR","stream: Malware FOUND\r\nmalformed",
    "stream: FOUND","stream: OK\nstream: BAD","",null,"x".repeat(600)]){
  assert.equal(parsePrivateClamavResponse(input),"unavailable");
 }
});

async function withDaemon(response,run){
 const seen=[];
 const server=createServer({allowHalfOpen:true},socket=>{
  socket.on("data",chunk=>seen.push(chunk));
  socket.on("end",()=>socket.end(response));
 });
 await new Promise((resolve,reject)=>{
  server.once("error",reject);
  server.listen(0,"127.0.0.1",resolve);
 });
 try{return await run(server.address().port,seen);}
 finally{await new Promise(resolve=>server.close(resolve));}
}

test("B8-3 real loopback INSTREAM framing: strict clean verdict",async()=>{
 const data=Buffer.from("%PDF-1.7 fixture-only scanner payload");
 await withDaemon("stream: OK\0",async(port,frames)=>{
  const result=await scanPrivateDocumentWithLocalClamav(data,{port,timeoutMs:2500});
  assert.equal(result,"clean");
  const stream=Buffer.concat(frames);
  assert.equal(stream.subarray(0,10).toString("ascii"),"zINSTREAM\0");
  assert.equal(stream.readUInt32BE(10),data.length);
  assert.deepEqual(stream.subarray(14,14+data.length),data);
  assert.equal(stream.readUInt32BE(14+data.length),0);
 });
});

test("B8-4 local ClamAV infection is rejected; unknown protocol never clean",async()=>{
 const content=Buffer.from("%PDF-1.7 fixture infected test stream");
 await withDaemon("stream: Synthetic-Malware FOUND\0",async port=>{
  assert.equal(await scanPrivateDocumentWithLocalClamav(content,{port,timeoutMs:2500}),"infected");
 });
 await withDaemon("stream: connection error ERROR\0",async port=>{
  assert.equal(await scanPrivateDocumentWithLocalClamav(content,{port,timeoutMs:2500}),"unavailable");
 });
});

test("B8-5 oversize, empty, untrusted scanner port never send bytes",async()=>{
 assert.equal(await scanPrivateDocumentWithLocalClamav(Buffer.alloc(0)),"unavailable");
 assert.equal(await scanPrivateDocumentWithLocalClamav(Buffer.alloc(MAX_PRIVATE_SCAN_BYTES+1)),"unavailable");
 assert.equal(await scanPrivateDocumentWithLocalClamav(Buffer.alloc(20),{port:70000}),"unavailable");
});

test("B8-6 one-shot worker is OFF by default: no remote queries or provider sends",()=>{
 const result=spawnSync(process.execPath,["scripts/mvp/vendor/run-private-evidence-scan-once.mjs"],{
  cwd:process.cwd(),encoding:"utf8",
  env:{PATH:process.env.PATH,NODE_ENV:"test"},
  timeout:5000,
 });
 assert.equal(result.status,3);
 assert.match(result.stderr,/PRIVATE_SCAN_DISABLED/);
 const source=readFileSync("scripts/mvp/vendor/run-private-evidence-scan-once.mjs","utf8");
 for(const gate of ["QF_VENDOR_PRIVATE_SCAN_MODE","QF_VENDOR_CLAMAV_ENGINE_CERTIFIED",
 "QF_VENDOR_PRIVATE_BUCKET_CERTIFIED","QF_VENDOR_PRIVATE_SCAN_ONCE_APPROVED",
 "QF_VENDOR_SCAN_PROJECT_REF","uckafzuochmbvtiodmcl"]){
  assert.ok(source.includes(gate),gate);
 }
 assert.match(source,/createHash\("sha256"\)/);
 assert.match(source,/\.public!==false/);
 assert.match(source,/scanPrivateDocumentWithLocalClamav\(bytes\)/);
 assert.match(source,/bytes\.fill\(0\)/);
 assert.match(source,/verdict!=="clean"&&verdict!=="infected"/);
 assert.doesNotMatch(source,/\.getPublicUrl\(|\.createSignedUrl\(|\.auth\.admin\.createUser\(/);
});

test("B8-7 private scan source is a narrow internal database append-only adapter",()=>{
 const sql=readFileSync("supabase/migrations/20261104173000_vendor_private_scan_quarantine.sql","utf8");
 assert.match(sql,/verification_scan_receipts_immutable/);
 assert.match(sql,/limit 4/);
 assert.match(sql,/e\.content_sha256=p_expected_sha256/);
 assert.match(sql,/v\.status='Pending' and v\.is_active=false/);
 assert.match(sql,/consent\.revoked_at is null/);
 assert.match(sql,/e\.scan_status='pending' and e\.evidence_state='pending'/);
 assert.match(sql,/p_verdict not in \('clean','infected'\)/);
 assert.match(sql,/when p_verdict='clean' then 'pending' else 'rejected'/);
 assert.match(sql,/revoke all on function public\.qf_vendor_record_private_scan/);
 assert.doesNotMatch(sql,/update public\.vendors|insert into public\.lead_assignments/);
});
