// Security proof: vendor profile displays are scoped by genuine GoTrue auth
// and canonical ACTIVE vendor_dashboard_users membership, not legacy fields.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = f => fs.readFileSync(path.join(root,f),"utf8");
const action = read("app/actions.ts");
const resolver = read("services/vendorAccessService.ts");
const functionText = action.split("export async function getMyVendor()")[1]
  ?.split("// PUBLIC (no auth)")[0] ?? "";
let n=0;
const check=(name,condition)=>{assert.equal(Boolean(condition),true,name);console.log("PASS",++n,name);};
check("vendor profile getter exists",functionText.includes('Promise<Result<import("../lib/types").VendorProfileSummary | null>>'));
check("only vendor-role principal",functionText.includes('u.role !== "vendor"'));
check("active canonical membership required",functionText.includes("const scope = await requireVendorAccess()"));
check("session actor bound to membership",functionText.includes("scope.data.authUserId !== u.id"));
check("vendor row selected only by canonical membership ID",functionText.includes('.eq("id", scope.data.vendorId)'));
check("no legacy owner field as authority",!functionText.includes('.eq("user_id", u.id)'));
check("membership failure denies",functionText.includes('return fail(appError("UNAUTHORIZED"))'));
check("privileged read after identity check",functionText.indexOf("await requireVendorAccess()") < functionText.indexOf("await adminClient()"));
check("verification and credits not login gating",!functionText.includes('.eq("verification_status"') && !functionText.includes('.gt("remaining_credits"'));
check("real GoTrue getUser in resolver",resolver.includes("sb.auth.getUser()"));
check("active membership is canonical",resolver.includes('const VENDOR_DASHBOARD_USERS_TABLE = "vendor_dashboard_users"') ||
  resolver.includes('export const VENDOR_DASHBOARD_USERS_TABLE = "vendor_dashboard_users"'));
check("profile route uses single getter",read("app/vendor/dashboard/profile/page.tsx").includes("const me = await getMyVendor()"));
check("dashboard layout uses single getter",read("app/vendor/dashboard/layout.tsx").includes("const me = await getMyVendor()"));
check("support uses single getter",read("app/vendor/dashboard/support/page.tsx").includes("const me = await getMyVendor()"));
check("notifications use single getter",read("app/vendor/dashboard/notifications/page.tsx").includes("const me = await getMyVendor()"));
console.log("VENDOR_CANONICAL_PROFILE_ACCESS_PASS "+n+"/"+n);
