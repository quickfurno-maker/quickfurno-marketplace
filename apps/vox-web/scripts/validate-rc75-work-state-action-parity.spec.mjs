import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../app/team/work-queue/WorkActionControl.tsx",import.meta.url),"utf8");
test("actual Staff form may submit only actions allowed by current Core work state",()=>{
 assert.match(source,/const options=candidates.filter/);
 assert.match(source,/const valid=recoveryReady&&storageAvailable&&!busy&&options.includes\(action\)/);
 assert.match(source,/\{!options.includes\(action\)\?<p role="status"/);
 assert.match(source,/originally selected action is no longer permitted by the current Core state/);
 const before=source.indexOf("const valid=");
 assert.ok(before<source.indexOf("async function submit("));
 assert.ok(source.indexOf("disabled={!valid}")>before);
});
test("original same-tab persisted work nonce still controls all valid replays",()=>{
 assert.match(source,/pending.current&&pending.current.command!==fingerprint/);
 assert.ok(source.indexOf("savePendingWork(tabStore()")<
  source.indexOf('fetch("/api/work-transitions"'));
 assert.ok(source.indexOf("isVerifiedWorkReceipt(body")<
  source.indexOf("clearPendingWork(tabStore()"));
 assert.doesNotMatch(source,/localStorage/);
});
