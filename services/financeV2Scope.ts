import "server-only";
import {adminClient} from "@/lib/supabase";
import {getVerifiedScopedStaff} from "@/services/vox/verifiedScopedStaff";
import {evaluateFinanceReadGrant} from "@/contracts/vox/financeReadGrant.mjs";
/** Validates a separate, revocable vendor-scoped Finance grant on every call. */
export async function financeStaffAllowed(
 scope:NonNullable<Awaited<ReturnType<typeof getVerifiedScopedStaff>>>,vendorId:string
):Promise<boolean>{
 if(process.env.FINANCE_V2_STAFF_READ_ENABLED!=="staging"||
  process.env.VOX_DEPARTMENT_ENFORCEMENT_ENABLED!=="staging")return false;
 const db=adminClient();
 const grants=await db.from("finance_staff_read_grants")
 .select("id,staff_user_id,team_id,city_id,vendor_id,requested_by,approved_by,approval_reference,expires_at")
 .eq("staff_user_id",scope.userId).eq("vendor_id",vendorId).limit(2);
 if(grants.error||!grants.data||grants.data.length!==1)return false;
 const revoked=await db.from("finance_staff_read_revocations")
 .select("id").eq("grant_id",grants.data[0].id).limit(1);
 if(revoked.error||!revoked.data)return false;
 return evaluateFinanceReadGrant({scope,grant:grants.data[0],vendorId,
  revoked:revoked.data.length!==0});
}
