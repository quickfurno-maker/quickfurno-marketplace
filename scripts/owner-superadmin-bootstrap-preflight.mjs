// Fail-closed, READ-ONLY Phase 22 guard for legacy Superadmin bootstrap.
// This deliberately does not mutate Supabase Auth, Core profiles, or identity roles.
// A passing result is NOT independent reviewer approval or atomic apply authority.
export const REQUIRED_PHASE22_TABLES=Object.freeze([
 ["identity_principals","id"],
 ["identity_provider_identities","principal_id"],
 ["identity_business_bindings","principal_id"],
 ["identity_admin_roles","principal_id"],
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function inspectOwnerBootstrapReadiness({supabase,user,targetEmail}){
 const failures=[];
 if(!user||typeof user.email!=="string"||
    user.email.trim().toLowerCase()!==targetEmail.trim().toLowerCase()||
    !UUID.test(String(user.id??""))||!user.email_confirmed_at)
  failures.push("VERIFIED_EXISTING_EMAIL_IDENTITY_REQUIRED");
 if(user?.app_metadata?.admin_role && user.app_metadata.admin_role!=="Superadmin")
  failures.push("TARGET_HAS_DIFFERENT_EXISTING_ADMIN_ROLE");
 for(const [table,column] of REQUIRED_PHASE22_TABLES){
  try{
   const result=await supabase.from(table).select(column).limit(1);
   if(result.error)failures.push("PHASE22_TABLE_UNAVAILABLE:"+table);
  }catch{failures.push("PHASE22_TABLE_UNAVAILABLE:"+table);}
 }
 let principalId=null,role=null;
 if(failures.length===0){
  try{
   const link=await supabase.from("identity_provider_identities")
    .select("principal_id,status")
    .eq("provider_key","supabase-primary")
    .eq("provider_subject",user.id).eq("status","active").maybeSingle();
   if(link.error||!UUID.test(String(link.data?.principal_id??"")))
    failures.push("ACTIVE_PROVIDER_PRINCIPAL_MAPPING_MISSING");
   else principalId=link.data.principal_id;
  }catch{failures.push("ACTIVE_PROVIDER_PRINCIPAL_MAPPING_MISSING");}
 }
 if(principalId){
  try{
   const p=await supabase.from("identity_principals")
    .select("id,status").eq("id",principalId).maybeSingle();
   if(p.error||p.data?.status!=="active")
    failures.push("PRINCIPAL_NOT_ACTIVE");
  }catch{failures.push("PRINCIPAL_NOT_ACTIVE");}
  try{
   const r=await supabase.from("identity_admin_roles")
    .select("admin_role,status").eq("principal_id",principalId).maybeSingle();
   if(r.error)failures.push("ROLE_CATALOG_NOT_READABLE");
   else if(r.data?.admin_role&&r.data.admin_role!=="Superadmin")
    failures.push("EXISTING_INCOMPATIBLE_ADMIN_ROLE");
   else if(r.data?.status&&r.data.status!=="active")
    failures.push("EXISTING_ADMIN_ROLE_REVOKED");
   else if(r.data)role=r.data;
  }catch{failures.push("ROLE_CATALOG_NOT_READABLE");}
 }
 if(user?.id&&UUID.test(user.id)){
  try{
   const p=await supabase.from("profiles")
    .select("id,role,is_active").eq("id",user.id).maybeSingle();
   if(p.error||!p.data||p.data.is_active!==true)
    failures.push("ACTIVE_CORE_PROFILE_REQUIRED");
   else if(p.data.role!==null&&p.data.role!=="admin")
    failures.push("PROFILE_HAS_INCOMPATIBLE_ROLE");
  }catch{failures.push("ACTIVE_CORE_PROFILE_REQUIRED");}
 }
 return Object.freeze({schema:"qf.owner.bootstrap.preflight.v1",
  existingEmailOnly:true,sourceEnvironmentMutation:false,
  userVerified:!failures.includes("VERIFIED_EXISTING_EMAIL_IDENTITY_REQUIRED"),
  phase22Complete:!failures.some(x=>x.startsWith("PHASE22_")||x.includes("PRINCIPAL")),
  alreadyAdmin:role?.admin_role==="Superadmin"&&role.status==="active",
  safeToConsiderApproval:failures.length===0,
  failures:Object.freeze(failures),
  independentApprovalVerified:false,atomicTransactionCertified:false,
  actualBootstrapApplied:false});
}
