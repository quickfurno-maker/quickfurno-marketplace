import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const migration=readFileSync(resolve(root,"ops/vox/rc4-approval-overlay/20261030020000_vox_rc4_approval_nonce_ledger_disposable.sql"),"utf8");
const verify=readFileSync(resolve(root,"ops/vox/rc4-approval-overlay/verify_rc4_approval_ledger_disposable_only.sql"),"utf8");
test("both sensitive public ledger tables enforce FORCE RLS",()=>{
 for(const table of ["vox_rc4_approval_ledger_v1","vox_rc4_key_revocations_v1"]){
  assert.match(migration,new RegExp("alter table public\\."+table+" enable row level security;"));
  assert.match(migration,new RegExp("alter table public\\."+table+" force row level security;"));
  assert.match(migration,new RegExp("revoke all on public\\."+table+" from public;"));
 }
});
test("all privileged RPCs revoke PUBLIC execute",()=>{
 for(const signature of [
  "qf_vox_rc4_append_only_v1\\(\\)",
  "qf_vox_rc4_claim_approval_keys_v1\\(text\\[\\],text,timestamptz\\)",
  "qf_vox_rc4_is_revoked_v1\\(text,uuid\\)"
 ])assert.match(migration,new RegExp("revoke all on function public\\."+signature+" from public;"));
});
test("disposable-only environment gate and rollback-only verifier are mandatory",()=>{
 assert.match(migration,/current_database\(\) !~ '\^qf_disposable_'/);
 assert.match(migration,/--network none|DISPOSABLE PG17 ONLY/i);
 assert.match(verify,/^begin;/m);
 assert.match(verify,/^rollback;/m);
 assert.match(verify,/VERIFY_FORCE_RLS_MISSING/);
 assert.match(verify,/VERIFY_UNTRUSTED_ROLE_PRIVILEGE/);
 assert.match(verify,/qf_rc4_untrusted_verify/);
});
test("approval records cannot be written from this ledger and source EOD gate remains off",()=>{
 assert.doesNotMatch(migration,/insert into public\.vox_ab7[g-h]_.*approval/i);
 const eod=readFileSync(resolve(root,"app/api/vox/v1/official-eod-publish/route.ts"),"utf8");
 assert.match(eod,/VERIFIED_APPROVAL_WRITER_INSTALLED=false/);
});
