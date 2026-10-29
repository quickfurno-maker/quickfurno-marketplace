// Source-only verified PRINCIPAL boundary, not a general token verifier.
// Caller must first verify Supabase Auth identity and AAL2; never accept JSON
// metadata from client requests or mutable raw_user_meta_data as authority.
export function isNeutralVoxStaffPrincipal(profile, verifiedUser) {
 if (!profile || !verifiedUser || typeof profile.id!=='string' ||
     profile.id!==verifiedUser.id || profile.role!==null || profile.is_active!==true)
   return false;
 const meta=verifiedUser.app_metadata;
 return Boolean(meta && typeof meta==='object' &&
   meta.qf_principal==='vox_staff' && meta.admin_role==null);
}
