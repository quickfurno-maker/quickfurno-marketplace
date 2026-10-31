import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const read=p=>readFileSync(resolve(root,p),"utf8");
test("verified EOD expiry is returned by signer verifier for final transactional check",()=>{
 const source=read("contracts/vox/rc4ApprovalPipeline.mjs");
 assert.match(source,/const expiresAtMs=Math\.min\(ownerEnvelope\.payload\.expiresAtMs,teamLeaderEnvelope\.payload\.expiresAtMs\)/);
 assert.match(source,/signatureExpiresAtMs:expiresAtMs/);
});
test("native pending EOD receipt denies expired real sessions and two signed envelopes before commit",()=>{
 const source=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 const insert=source.indexOf("INTENT_RECEIPT_UNVERIFIED");
 const guard=source.indexOf("SIGNED_EOD_IDENTITY_OR_ENVELOPE_EXPIRED_DURING_TRANSACTION");
 const commit=source.indexOf('client.query("COMMIT")',guard);
 assert.ok(insert>0&&guard>insert&&commit>guard);
 for(const claim of ["signed.signatureExpiresAtMs<=atCommit",
   "ownerAuth.sessionExpiresAtMs<=atCommit","teamLeaderAuth.sessionExpiresAtMs<=atCommit",
   "teamLeaderAuth.membershipExpiresAtMs<=atCommit"])
  assert.ok(source.includes(claim),claim);
 assert.match(source,/await client\.query\("ROLLBACK"\);settled=true;\s*return deny\("SIGNED_EOD_IDENTITY_OR_ENVELOPE_EXPIRED_DURING_TRANSACTION"\)/);
 assert.match(source,/RC8_APPROVAL_WRITER_INSTALLED=false/);
 assert.match(source,/humanKeyCeremonyComplete:false/);
});

test("signed EOD recomputes branded Owner and Team Leader AAL2 freshness at COMMIT",()=>{
 const verifier=read("contracts/vox/rc4ApprovalPipeline.mjs");
 const writer=read("scripts/mvp/vox/rc8-pg-signed-intent-writer.mjs");
 const pg=read("scripts/mvp/vox/validate-vox-rc8-real-pg-signed-intent.mjs");
 assert.match(verifier,/export function checkRc4ApproversAtCommit/);
 assert.match(verifier,/checkAuth\(ownerAuth,"OWNER",now\)/);
 assert.match(verifier,/checkAuth\(teamLeaderAuth,"TEAM_LEADER",now\)/);
 assert.match(writer,/checkRc4ApproversAtCommit\(ownerAuth,teamLeaderAuth/);
 assert.match(writer,/SIGNED_EOD_AAL2_STALE_DURING_TRANSACTION/);
 assert.match(pg,/IN_FLIGHT_AAL2_FRESHNESS_DENIED/);
 assert.match(pg,/STALE_AAL2_NO_NONCE/);
 assert.match(pg,/STALE_AAL2_NO_RECEIPT/);
});
