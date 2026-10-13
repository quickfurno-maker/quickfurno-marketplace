// Vendor OS V3: no live DB, no external provider. Model-level and fake-Core
// tests of typed vendor change intake, review-only surfaces and authorization.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
const read=x=>fs.readFileSync(path.join(root,x),"utf8");
const source=read("services/vendorGovernedChangeIntakeService.ts");
const transpiled=ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const vendorId="11111111-1111-4111-8111-111111111111";
const ownerId="22222222-2222-4222-8222-222222222222";
const stranger="33333333-3333-4333-8333-333333333333";
const vendor={id:vendorId,user_id:ownerId,owner_name:"Before",email:"old@example.test",
  phone:"+919812345678",city:"Pune",service_categories:["Carpenters"],areas_covered:["Baner"]};
let inserts=[];let canonicalWrites=0;
const errors={appError:(code)=>Object.assign(new Error(code),{code}),
  fail:(error)=>({ok:false,code:error.code||"FAILED",error}),
  ok:data=>({ok:true,data})};
function dbQuery(table){
  const where={};let inserting=null;
  return {
    select(){return this;},
    eq(k,v){where[k]=v;return this;},
    maybeSingle:async()=>({data:table==="vendors" &&
      Object.entries(where).every(([k,v])=>vendor[k]===v)?{...vendor}:null,error:null}),
    insert(row){if(table!=="vendor_profile_change_requests")throw Error("illegal write");inserting=row;return this;},
    single:async()=>{
      if(!inserting)throw Error("unexpected write");
      if(inserts.some(x=>x.vendor_id===inserting.vendor_id &&
        x.request_type===inserting.request_type && x.status==="pending"))
        return {data:null,error:new Error("unique pending")};
      const record={id:"44444444-4444-4444-8444-444444444444",...inserting};
      inserts.push(record);return {data:record,error:null};
    },
    update(){canonicalWrites++;throw Error("FORBIDDEN CANONICAL WRITE");},
  };
}
const mocks={
  "server-only":{},
  "@/lib/supabase":{adminClient:()=>({from:dbQuery})},
  "@/lib/errors":errors,
  "@/services/vendorAccessService":{ requireVendorScope: async id => id === vendorId
    ? {ok:true,data:{vendorId,authUserId:ownerId,role:"owner",membershipStatus:"active"}}
    : {ok:false,code:"UNAUTHORIZED"} },
};
const module={exports:{}};
new Function("module","exports","require",transpiled)(module,module.exports,k=>{
  if(!(k in mocks))throw Error("UNMOCKED_IMPORT:"+k);return mocks[k];
});
const api=module.exports;
let count=0;
function check(label,expr){assert.equal(Boolean(expr),true,label);console.log("PASS",++count,label);}
function invalid(input){try{api.validateGovernedChange(input);return false}catch{return true}}
check("reject invalid family",invalid({family:"credit_edit",remaining_credits:9999}));
check("reject empty contact",invalid({family:"owner_contact_change"}));
check("reject invalid email",invalid({family:"owner_contact_change",email:"oops"}));
check("reject invalid phone",invalid({family:"owner_contact_change",phone:"123"}));
check("reject ambiguous national number",invalid({family:"owner_contact_change",phone:"9876543210"}));
check("reject excessive owner",invalid({family:"owner_contact_change",owner_name:"a".repeat(101)}));
check("accept normalized safe email",
  api.validateGovernedChange({family:"owner_contact_change",email:"  HI@EXAMPLE.TEST "}).proposed.email==="hi@example.test");
check("reject missing service city",invalid({family:"service_coverage_change",requested_categories:["Carpenters"]}));
check("reject unapproved category",invalid({family:"service_coverage_change",requested_city:"Pune",requested_categories:["Weapons"]}));
check("reject duplicate categories",invalid({family:"service_coverage_change",requested_city:"Pune",requested_categories:["Carpenters","Carpenters"]}));
check("reject empty categories",invalid({family:"service_coverage_change",requested_city:"Pune",requested_categories:[]}));
const unauth=await api.createGovernedVendorChangeRequest(vendorId,stranger,
 {family:"owner_contact_change",email:"new@example.test"});
check("other vendor denied",!unauth.ok && inserts.length===0);
const valid=await api.createGovernedVendorChangeRequest(vendorId,ownerId,
 {family:"owner_contact_change",email:"new@example.test"});
check("owner request created",valid.ok && valid.data.status==="pending" && inserts.length===1);
check("only sanitized proposed contact stored",
  JSON.stringify(inserts[0].proposed_changes)==='{"email":"new@example.test"}');
check("before snapshot retained",inserts[0].current_snapshot.email==="old@example.test");
check("no canonical write",canonicalWrites===0 && vendor.email==="old@example.test");
const replay=await api.createGovernedVendorChangeRequest(vendorId,ownerId,
 {family:"owner_contact_change",email:"new2@example.test"});
check("pending duplicate held",!replay.ok && inserts.length===1);
const coverage=await api.createGovernedVendorChangeRequest(vendorId,ownerId,
 {family:"service_coverage_change",requested_city:"Pune",requested_categories:["Carpenters"]});
check("coverage request creates separate kind",coverage.ok && inserts.length===2);
check("coverage cannot grant matching",vendor.city==="Pune" && canonicalWrites===0 &&
 !("location_verification_status" in inserts[1].proposed_changes));
const action=read("app/actions.ts");
check("session actor required",action.includes('actor.role !== "vendor"'));
check("server action sources canonical vendor id",action.includes("const scope = await requireVendorAccess()") &&
  action.includes("createGovernedVendorChangeRequest(scope.data.vendorId, actor.id, payload)"));
check("canonical vendor membership rechecked",source.includes("requireVendorScope(vendorId)") && source.includes("access.data.vendorId"));
check("admin queue locks approval for restricted",read("components/admin/vendor-approvals/VendorApprovalQueue.tsx")
 .includes("office || restricted || matchingSensitive || fields.length === 0"));
check("UI marks city non-Google-verified",read("components/vendor-dashboard-v2/profile/VendorGovernedChangeRequestForms.tsx")
 .includes("NOT a verified Google location"));
check("safe no wallet field in intake",!source.includes("remaining_credits") && !source.includes("credit_balance"));
console.log("V3_RESTRICTED_INTAKE_CERT_PASS "+count+"/"+count);
