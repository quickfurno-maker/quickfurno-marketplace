import test from "node:test";
import assert from "node:assert/strict";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {containedSourceFiles} from "./rc55-private-baseline-containment.mjs";
const embedded="-- Original migration example\nCREATE TABLE demo (id uuid PRIMARY KEY);\n";
const separate="-- Different migration example\nCREATE TABLE other (id uuid PRIMARY KEY);\n";
const entries=[{file:"a.sql",sql:embedded,digest:canonicalSqlDigest(embedded)},
 {file:"b.sql",sql:separate,digest:canonicalSqlDigest(separate)}];
test("strictly embedded source SQL is reported without promoting any alias or migration",()=>{
 const r=containedSourceFiles("PREFIX\n"+embedded+"SUFFIX",entries);
 assert.equal(r.sourceFilesChecked,2);
 assert.deepEqual(r.strictContiguousSourceEmbeds,["a.sql"]);
 assert.equal(r.notStrictlyEmbedded,1);
 assert.equal(r.verifiedAliasCount,0);
 assert.equal(r.releaseGo,false);
});
test("source file mutation, duplicate or invalid digest cannot be presented as evidence",()=>{
 assert.throws(()=>containedSourceFiles(embedded,[{...entries[0],sql:embedded+" -- tampered"}]),/RC55_SOURCE_UNTRUSTED/);
 assert.throws(()=>containedSourceFiles(embedded,[entries[0],entries[0]]),/RC55_SOURCE_UNTRUSTED/);
 assert.throws(()=>containedSourceFiles(embedded,[{...entries[0],digest:"bad"}]),/RC55_SOURCE_UNTRUSTED/);
});
