import test from "node:test";import assert from "node:assert/strict";
import {readFileSync} from "node:fs";import path from "node:path";
import {inspectPay4aMigrationInventory} from "./audit-finance-pay4a-migration.mjs";
const root=path.resolve(import.meta.dirname,"../../..");
test("PAY4A quarantined legacy VOX source matches pinned hash without remote authority",()=>{
 const p=inspectPay4aMigrationInventory({root});
 assert.equal(p.ok,true,JSON.stringify(p.issues));assert.equal(p.canDeploy,false);
 assert.equal(p.quarantinedHash,p.ledgerHash);
 assert.equal(p.legacyValidatorNeedsInventoryReconciliation,true);
});
test("PAY4A detects tampered quarantine and never approves",()=>{
 const p=inspectPay4aMigrationInventory({root,read:(file,encoding)=>{
  const b=readFileSync(file,encoding);
  return String(file).includes("quarantined-migrations")?Buffer.from("malicious"):b;
 }});
 assert.equal(p.ok,false);assert.ok(p.issues.includes("QUARANTINED_SQL_HASH_DRIFT"));
});
