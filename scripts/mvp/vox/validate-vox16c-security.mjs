import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),get=p=>readFileSync(resolve(root,p),'utf8');
const targets=[
 ['Core AAL2',"services/vox/verifiedScopedStaff.ts","jwt.aal!==\"aal2\""],
 ['Core scope grant recheck',"services/vox/verifiedScopedStaff.ts",'vox_staff_object_scopes_v1'],
 ['Canonical city check',"app/api/vox/v1/agent-subject-access/route.ts",'.eq("city_id",scope.cityId)'],
 ['Only HUMAN read',"app/api/vox/v1/agent-subject-access/route.ts",'.eq("state","HUMAN")'],
 ['Exact revision',"app/api/vox/v1/agent-subject-access/route.ts",'.eq("revision",query.revision)'],
 ['Private staff scope read',"app/api/vox/v1/desk/route.ts",'getVerifiedScopedStaff'],
 ['Core own action review',"app/api/vox/v1/action-intents/route.ts",'verifyVoxOwnerBearer'],
 ['Task action opt-in',"app/api/vox/v1/support-task/route.ts",'VOX_SUPPORT_INTERNAL_TASKS_ENABLED'],
 ['No profile mutation',"app/api/vox/v1/vendor-profile-review/route.ts",'CORE_APPROVAL_REQUIRED'],
 ['No provider sends',"app/api/vox/v1/vendor-profile-review/route.ts",'actionsEnabled:false'],
 ['True v3 atomic profile approver',"services/vendorProfileChangeService.ts",'qf_approve_vendor_profile_update_v3'],
 ['Known location split-write blocked',"services/vendorProfileChangeService.ts",'request.request_type === "office_location_change"']
];
let n=0;for(const [name,file,s] of targets){
 assert.ok(get(file).includes(s),'SOURCE_SECURITY_GATE_MISSING '+name);
 console.log('PASS '+name);n++;
}
const doc=get('docs/vox/VOX-16C-EXISTING-SUPABASE-SECURITY-FINDINGS.md');
for(const term of ['vendor_public_v','is_admin()','owns_vendor','SECURITY DEFINER','leaked-password','RELEASE HOLD']){
 assert.ok(doc.includes(term));n++;console.log('PASS documented '+term);
}
console.log('VOX16C_SECURITY_SOURCE_AND_FINDINGS_PASS '+n+'/'+n);
