import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve as resolvePath} from "node:path";
import {resolveScopedStaff,filterHumanConversations} from "../../../contracts/vox/scopedStaff.mjs";
const ROOT=resolvePath(import.meta.dirname,"../../..");
const file=p=>readFileSync(resolvePath(ROOT,p),"utf8");
const user="11111111-1111-4111-8111-111111111111";
const teamId="22222222-2222-4222-8222-222222222222";
const cityId="33333333-3333-4333-8333-333333333333";
const prospect="44444444-4444-4444-8444-444444444444";
const vendor="55555555-5555-4555-8555-555555555555";
const thread="66666666-6666-4666-8666-666666666666";
const convo="77777777-7777-4777-8777-777777777777";
const now=Date.now();
const after=new Date(now+60000).toISOString();
const ctx={userId:user,identityVerified:true,membership:{auth_user_id:user,team_id:teamId,staff_role:"operations_manager",is_active:true,expires_at:after,revoked_at:null},team:{id:teamId,city_id:cityId,is_active:true},grants:[
{auth_user_id:user,scope_kind:"prospect",object_id:prospect,expires_at:after,revoked_at:null},
{auth_user_id:user,scope_kind:"vendor",object_id:vendor,expires_at:after,revoked_at:null},
{auth_user_id:user,scope_kind:"support_thread",object_id:thread,expires_at:after,revoked_at:null},
{auth_user_id:user,scope_kind:"conversation",object_id:convo,expires_at:after,revoked_at:null},
],now};
let count=0;
function test(name,fn){fn();count++;console.log("PASS "+name);}
const resolve=x=>resolveScopedStaff({...ctx,...x});
test("verified member receives exact vendor grant",()=>assert.deepEqual(resolve().vendorIds,[vendor]));
test("anonymous rejected",()=>assert.equal(resolve({identityVerified:false}),null));
test("member different user rejected",()=>assert.equal(resolve({userId:prospect}),null));
test("inactive membership rejected",()=>assert.equal(resolve({membership:{...ctx.membership,is_active:false}}),null));
test("revoked membership rejected",()=>assert.equal(resolve({membership:{...ctx.membership,revoked_at:after,is_active:false}}),null));
test("expired membership rejected",()=>assert.equal(resolve({membership:{...ctx.membership,expires_at:new Date(now-1000).toISOString()}}),null));
test("wrong team rejected",()=>assert.equal(resolve({team:{...ctx.team,id:prospect}}),null));
test("inactive team rejected",()=>assert.equal(resolve({team:{...ctx.team,is_active:false}}),null));
test("malformed city rejected",()=>assert.equal(resolve({team:{...ctx.team,city_id:"Pune"}}),null));
test("unknown role rejected",()=>assert.equal(resolve({membership:{...ctx.membership,staff_role:"Superadmin"}}),null));
test("support role has no prospect permission",()=>assert.equal(resolve({membership:{...ctx.membership,staff_role:"support_agent"}}).prospectIds.length,0));
test("acquisition has no vendor permission",()=>assert.equal(resolve({membership:{...ctx.membership,staff_role:"acquisition_agent"}}).vendorIds.length,0));
test("auditor cannot view conversation",()=>assert.equal(resolve({membership:{...ctx.membership,staff_role:"auditor"}}).conversationIds.length,0));
test("scope from other actor ignored",()=>assert.equal(resolve({grants:[{...ctx.grants[0],auth_user_id:vendor}]}).prospectIds.length,0));
test("expired scope ignored",()=>assert.equal(resolve({grants:[{...ctx.grants[0],expires_at:new Date(now-1).toISOString()}]}).prospectIds.length,0));
test("revoked scope ignored",()=>assert.equal(resolve({grants:[{...ctx.grants[0],revoked_at:after}]}).prospectIds.length,0));
test("scope overflow rejected",()=>assert.equal(resolve({grants:Array(201).fill(ctx.grants[0])}),null));
test("no assignment grants no objects",()=>assert.deepEqual(resolve({grants:[]}).vendorIds,[]));
const row={id:convo,subject_type:"vendor",subject_id:vendor,state:"HUMAN",human_takeover:true,revision:1};
test("assigned vendor human thread allowed",()=>assert.equal(filterHumanConversations([row],resolve(),[],[vendor]).length,1));
test("wrong vendor human thread denied",()=>assert.equal(filterHumanConversations([row],resolve(),[],[prospect]).length,0));
test("client human thread denied",()=>assert.equal(filterHumanConversations([{...row,subject_type:"client"}],resolve(),[],[vendor]).length,0));
test("AI conversation denied",()=>assert.equal(filterHumanConversations([{...row,state:"AI"}],resolve(),[],[vendor]).length,0));
test("unassigned conversation denied",()=>assert.equal(filterHumanConversations([{...row,id:prospect}],resolve(),[],[vendor]).length,0));
test("private message not exposed",()=>assert.doesNotMatch(JSON.stringify(filterHumanConversations([{...row,message:"PRIVATE",phone:"9876543210"}],resolve(),[],[vendor])),/PRIVATE|9876543210/));
const sql=file("supabase/migrations/20261014010000_vox_v1_scoped_staff_authority.sql");
test("all four tables RLS enabled",()=>assert.equal((sql.match(/enable row level security;/g)||[]).length,4));
test("memberships default inactive",()=>assert.match(sql,/is_active boolean not null default false/));
test("no authenticated table grants",()=>assert.doesNotMatch(sql,/grant .* to authenticated/));
test("grant audit append only",()=>assert.match(sql,/grant select, insert on public.vox_staff_grant_audit_v1 to service_role/));
const route=file("app/api/vox/v1/my-work/route.ts");
test("route requires authenticated scope",()=>assert.match(route,/getVerifiedScopedStaff/));
test("prospect exact city",()=>assert.match(route,/\.eq\("city_id",scope\.cityId\)/));
test("vendor validated by exact Core grants followed by active canonical service zones",()=>{assert.match(route,/\.in\("id",\[\.\.\.scope\.vendorIds\]\)/);assert.match(route,/\.in\("id",zoneIds\)/);assert.match(route,/deriveCanonicalCityVendorIds\(/);});
test("support requires dual scope",()=>assert.match(route,/\.in\("id",\[\.\.\.scope\.supportThreadIds\]\)\.in\("vendor_id",permittedVendorIds\)/));
test("all mutations refused",()=>assert.equal((route.match(/READ_ONLY"\},405/g)||[]).length,4));
console.log("VOX_03_SCOPED_STAFF_PASS "+count+"/33");
