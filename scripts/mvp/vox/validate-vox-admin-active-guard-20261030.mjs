import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
// SOURCE-CONTRACT test. LIMITATION: it does not execute the guards (the real
// Next cookies / Supabase modules are not mocked), so it proves the source shape,
// not runtime behavior. Part 2 exercises a replica of the predicate against the
// true/false/NULL/absent/error matrix; the replica is not the shipped code.
const read=p=>readFileSync(resolve(import.meta.dirname,"../../../",p),"utf8");
const actions=read("app/actions.ts"),crm=read("lib/crm/crmAuth.ts"),
 access=read("services/vendorAccessService.ts"),identity=read("services/identityDirectoryService.ts");
let n=0;const check=(name,fn)=>{fn();n++;console.log("PASS",name)};

check("app/actions currentUser selects is_active and gates admin on strict true",()=>{
 assert.match(actions,/\.select\("role, is_active"\)/);
 assert.match(actions,/rawRole === "admin" && profile\?\.is_active !== true \? undefined : rawRole/);
 assert.match(actions,/profileError \? undefined/);
});
check("requireAdmin/requireVendorOwner/getMyRole/getAdminSession all derive from currentUser",()=>{
 assert.match(actions,/async function requireAdmin\(\) \{\s*const u = await currentUser\(\);/);
 assert.match(actions,/if \(u\.role === "admin"\) return u;/);
 assert.match(actions,/return u\?\.role \?\? null;/);
 assert.match(actions,/isAdmin: u\?\.role === "admin"/);
});
check("no raw profiles.role-only admin read remains in app/actions",()=>{
 assert.doesNotMatch(actions,/\.select\("role"\)/);
});
check("crmAuth fails closed on read error and requires is_active === true",()=>{
 assert.match(crm,/\.select\("role, is_active"\)/);
 assert.match(crm,/if \(profileError\) throw appError\("UNAUTHORIZED"\)/);
 assert.match(crm,/profile\?\.is_active !== true/);
 assert.doesNotMatch(crm,/\.select\("role"\)/);
});
check("vendorAccessService.requireAdminSession requires is_active === true",()=>{
 assert.match(access,/\.select\("role, is_active"\)/);
 assert.match(access,/row\?\.role !== "admin" \|\| row\.is_active !== true/);
});
check("identityDirectoryService denies non-true is_active and no longer treats NULL as active",()=>{
 assert.match(identity,/profile\.data\.role !== "admin" \|\| profile\.data\.is_active !== true/);
 assert.doesNotMatch(identity,/is_active !== false/);
});

// Part 2: predicate replica matrix (documents intended semantics only).
const isAdmin=(r)=>!r.error&&!!r.data&&r.data.role==="admin"&&r.data.is_active===true;
check("predicate matrix: true admits; false/NULL/absent/error/malformed deny",()=>{
 assert.equal(isAdmin({data:{role:"admin",is_active:true}}),true);
 assert.equal(isAdmin({data:{role:"admin",is_active:false}}),false);
 assert.equal(isAdmin({data:{role:"admin",is_active:null}}),false);
 assert.equal(isAdmin({data:{role:"admin"}}),false);
 assert.equal(isAdmin({data:null}),false);
 assert.equal(isAdmin({data:{role:"admin",is_active:true},error:{message:"x"}}),false);
 assert.equal(isAdmin({data:{role:"admin",is_active:"true"}}),false);
 assert.equal(isAdmin({data:{role:"vendor",is_active:true}}),false);
});
console.log("VOX_ADMIN_ACTIVE_GUARD_SOURCE_PASS "+n+"/"+n);
