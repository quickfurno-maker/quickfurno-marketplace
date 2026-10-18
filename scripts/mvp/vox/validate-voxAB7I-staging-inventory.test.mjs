import test from "node:test";import assert from "node:assert/strict";
import {assessAb7iStagingInventory as assess,
 ab7iRequiredCanonicalTables as base,ab7iRequiredVoxTables as vox}
 from "../../../contracts/vox/ab7iStagingMigrationPreflight.mjs";
const hash="a".repeat(64);
const spec=()=>({projectKind:"QuickFurno Staging",
 tableNames:[...base],migrationSha256:hash,rollbackSha256:hash});
test("AB7I real staging current base/no VOX is NOT release ready",()=>{
 const x=assess(spec());assert.equal(x.ready,false);
 assert.equal(x.reason,"VOX_MIGRATIONS_NOT_INSTALLED");
 assert.equal(x.canApply,false);assert.equal(x.missing.includes("vox_staff_memberships_v1"),true);
});
test("AB7I partial migration is drift stop and never auto-installs",()=>{
 const x=assess({...spec(),tableNames:[...base,vox[0]]});
 assert.equal(x.schemaDrift,true);assert.equal(x.canApply,false);
});
test("AB7I missing base, forged project and repeated rows denied",()=>{
 for(const patch of [
 {tableNames:base.filter(x=>x!=="communication_preferences")},
 {projectKind:"QuickFurno"},
 {tableNames:[...base,base[0]]}
 ]){const x=assess({...spec(),...patch});assert.equal(x.ready,false);}
});
test("AB7I full offline schema still requires human review/Owner GO",()=>{
 const x=assess({...spec(),tableNames:[...base,...vox]});
 assert.equal(x.ready,false);assert.equal(x.canApply,false);
 const y=assess({...spec(),tableNames:[...base,...vox],
 signedIndependentReview:true,ownerGo:true});
 assert.equal(y.ready,true);assert.equal(y.canApply,false);
});
