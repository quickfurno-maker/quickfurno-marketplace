/**
 * Server-only, read-only vendor signup ownership inspection.
 *
 * This is NOT an OTP verification endpoint or a signup transaction. It resolves
 * the current request's Auth identity using getUser() (not decoded JWT
 * metadata), then loads every relevant account/phone/dashboard conflict from
 * service-role queries with duplicate detection. A separate trusted controller
 * must prove a NEW vendor-purpose WhatsApp OTP delivery before using the pure
 * reconciliation decision and attempting an idempotent registration transaction.
 *
 * No public route imports this module until that controller is certified.
 */
import "server-only";
import { adminClient, serverClient } from "../lib/supabase";
import { normalizeVerifiedVendorMobile } from "../lib/vendors/vendorContactContract";
import type {
  VendorOwnershipRow,
  VendorDashboardOwnershipRow,
  VendorOwnershipSnapshot,
} from "../lib/vendors/vendorSignupOwnershipReconciliation";
import type { VerifiedVendorSignupEvidence } from "../lib/vendors/vendorVerifiedSignupDecision";

type UnsignedSignupEvidence = Omit<VerifiedVendorSignupEvidence, "serverOtpAdmission">;
export interface VendorSignupOwnershipInspection {
  readonly unsignedEvidence: UnsignedSignupEvidence;
  readonly snapshot: VendorOwnershipSnapshot;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function inspectVendorSignupOwnershipFromCurrentSession(
  submittedMobile: string,
): Promise<VendorSignupOwnershipInspection | null> {
  try {
    const mobile10 = normalizeVerifiedVendorMobile(submittedMobile);
    if (!mobile10) return null;

    // Signed Auth server confirmation, not an unverified request body user_id.
    const sb = await serverClient();
    const { data: auth, error: authError } = await sb.auth.getUser();
    const user = auth?.user;
    if (authError || !user || !UUID.test(user.id) ||
        user.phone !== "+91" + mobile10) return null;

    const db = adminClient();
    const [profile, client, byUser, byMobile, dashboard] = await Promise.all([
      db.from("profiles").select("id,role").eq("id",user.id).maybeSingle(),
      db.from("client_accounts").select("id").eq("user_id",user.id).limit(2),
      db.from("vendors").select("id,user_id,phone").eq("user_id",user.id).limit(2),
      db.from("vendors").select("id,user_id,phone").eq("phone",mobile10).limit(2),
      db.from("vendor_dashboard_users").select("vendor_id,user_id,role,status")
        .eq("user_id",user.id).limit(2),
    ]);
    if (profile.error || !profile.data || client.error || byUser.error ||
        byMobile.error || dashboard.error ||
        !Array.isArray(client.data) || !Array.isArray(byUser.data) ||
        !Array.isArray(byMobile.data) || !Array.isArray(dashboard.data)) {
      return null; // Lookup failure is never a negative ownership assertion.
    }
    if (client.data.length > 1 || byUser.data.length > 1 ||
        byMobile.data.length > 1 || dashboard.data.length > 1) return null;

    const vendorsByAuthUser = byUser.data as VendorOwnershipRow[];
    const vendorsByMobile = byMobile.data as VendorOwnershipRow[];
    const dashboardByAuthUser = dashboard.data as VendorDashboardOwnershipRow[];
    const linked = vendorsByAuthUser.length === 1 ? vendorsByAuthUser[0] : null;
    const snapshot: VendorOwnershipSnapshot = {
      vendorsByAuthUser, vendorsByMobile, dashboardByAuthUser,
    };
    return {
      snapshot,
      unsignedEvidence: {
        authUserId: user.id,
        authPhoneE164: user.phone,
        submittedMobile: mobile10,
        phoneConfirmedAt: user.phone_confirmed_at ?? null,
        // Deliberately NO "admitted" property: Auth phone confirmation is
        // insufficient to prove a fresh vendor-purpose WhatsApp delivery.
        existingClientAccount: client.data.length !== 0,
        existingProfileRole: profile.data.role ?? null,
        existingVendorLink: linked ? {
          authUserId: String(linked.user_id ?? ""),
          vendorId: String(linked.id ?? ""),
          phone: String(linked.phone ?? ""),
        } : null,
      },
    };
  } catch {
    return null;
  }
}
