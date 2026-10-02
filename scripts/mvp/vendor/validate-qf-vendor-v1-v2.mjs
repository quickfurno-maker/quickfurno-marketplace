import fs from "node:fs";

function read(path) {
  return fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

const files = {
  migration: read("supabase/migrations/20261002040748_vendor_v2_commercial_activation.sql"),
  statusRoute: read("app/api/admin/vendors/[id]/status/route.ts"),
  vendorsUi: read("components/admin/sections/VendorsSection.tsx"),
  verificationSummary: read("services/vendorVerificationSummaryService.ts"),
  verificationUi: read("components/vendor-dashboard-v2/profile/VendorWhatsAppVerificationCard.tsx"),
  profilePage: read("app/vendor/dashboard/profile/page.tsx"),
  paymentService: read("services/vendorPackagePaymentService.ts"),
  paymentHelper: read("lib/payments/vendorPackageRazorpay.ts"),
  packageWorkspace: read("components/vendor-dashboard-v2/package/VendorPackageWorkspace.tsx"),
  payButton: read("components/vendor-dashboard-v2/package/VendorPackagePayButton.tsx"),
  packagePage: read("app/vendor/dashboard/package/page.tsx"),
};

let passed = 0;
let failed = 0;

function check(name, condition) {
  const number = String(passed + failed + 1).padStart(2, "0");
  if (condition) {
    passed += 1;
    console.log(`PASS ${number} ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${number} ${name}`);
  }
}

check("approval route uses canonical vendor login activation", files.statusRoute.includes("activateVendorLogin({ vendorId })"));
check("approval reports login provisioning separately from approval truth", files.statusRoute.includes("loginActivationError"));
check("admin UI preserves one-time recovery link in memory modal", files.vendorsUi.includes("recoveryLink: result.loginActivation.recoveryLink"));
check("vendor contact summary resolves canonical vendor access", files.verificationSummary.includes("requireVendorAccess()"));
check("contact verification readiness comes from automation catalog", files.verificationSummary.includes('"communication_automation_catalog"'));
check("vendor verification UI calls hardened WhatsApp request endpoint", files.verificationUi.includes("/api/vendor/auth/whatsapp/request"));
check("vendor verification UI calls hardened WhatsApp verify endpoint", files.verificationUi.includes("/api/vendor/auth/whatsapp/verify"));
check("profile page loads operational contact verification state", files.profilePage.includes("getCurrentVendorContactVerificationSummary()"));

check("commercial migration creates category package scope", files.migration.includes("create table if not exists public.package_service_category_scopes"));
check("commercial migration creates city package scope", files.migration.includes("create table if not exists public.package_city_scopes"));
check("commercial scope tables deny browser roles", files.migration.includes("revoke all on table public.package_service_category_scopes from public, anon, authenticated"));
check("Razorpay order records explicit provider mode", files.migration.includes("add column if not exists provider_mode text"));
check("financial activation RPC is service-role only", files.migration.includes("grant execute on function public.qf_activate_vendor_package_order_v2(uuid,text,text) to service_role"));
check("financial activation uses canonical credit wallet", files.migration.includes("public.qf_apply_vendor_credit_delta("));
check("financial activation idempotency is ledger anchored", files.migration.includes("reference_type = 'package_purchase'"));
check("commercial migration fails if browser financial authority leaks", files.migration.includes("VENDOR_V2_COMMERCIAL_AUTHORITY_EXPOSED"));

check("payment runtime defaults fail closed", files.paymentService.includes('process.env.RAZORPAY_VENDOR_PACKAGE_MODE ?? "disabled"'));
check("payment runtime supports both explicit test and live modes", files.paymentService.includes('value === "test" || value === "live"'));
check("live and test secrets use separate environment variables", files.paymentService.includes("RAZORPAY_LIVE_KEY_SECRET") && files.paymentService.includes("RAZORPAY_TEST_KEY_SECRET"));
check("provider mode is checked before using existing orders", files.paymentService.includes("assertOrderMode(order, cfg)"));
check("checkout success fetches provider payment server-side", files.paymentService.includes("/payments/"));
check("captured payment assertion gates activation", files.paymentService.includes("assertCapturedPayment(payment"));
check("checkout signature is HMAC validated", files.paymentHelper.includes("verifyCheckoutSignature"));
check("webhook raw body is HMAC validated", files.paymentHelper.includes("verifyWebhookSignature"));
check("key helper rejects wrong live/test key prefix", files.paymentHelper.includes('mode === "live" ? "rzp_live_" : "rzp_test_"'));
check("package UI renders payment only from server availability", files.packageWorkspace.includes("paymentAvailability.enabled") && files.packageWorkspace.includes("<VendorPackagePayButton"));
check("package page derives payment availability server-side", files.packagePage.includes("getVendorPackagePaymentAvailability()"));
check("live checkout copy has explicit safe branch", files.payButton.includes('mode === "test"') && files.payButton.includes('"Pay securely"'));
check("browser payment success never writes credits directly", !files.payButton.includes("remaining_credits") && !files.payButton.includes("qf_apply_vendor_credit_delta"));

console.log(`\nVendor V1/V2 guard: ${passed}/${passed + failed} checks passed.`);
if (failed > 0) process.exit(1);
