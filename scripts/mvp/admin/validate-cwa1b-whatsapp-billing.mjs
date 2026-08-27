// ============================================================================
// C-WA1B — truthful WhatsApp Billing & spend visibility.
//
// Offline: no database, provider, auth or network call. This successor harness
// preserves C-WA1 and locks the billing read model, Provider-tab placement,
// explicit unavailable states and zero-write security posture.
// ============================================================================
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`   ok    ${name}`);
  } else {
    failed += 1;
    console.log(`   FAIL  ${name}`);
  }
}

const pkg = JSON.parse(read("package.json"));
const service = read("services/adminWhatsAppService.ts");
const serviceCode = stripComments(service);
const route = read("app/admin/whatsapp/page.tsx");
const types = read("components/admin/whatsapp/whatsappAdminTypes.ts");
const shell = read("components/admin/whatsapp/WhatsAppControlCenter.tsx");
const provider = read("components/admin/whatsapp/WhatsAppProviderTab.tsx");
const providerCode = stripComments(provider);
const css = read("app/globals.css");
const cwa1 = read("scripts/mvp/admin/validate-c-wa1-whatsapp-control-center.mjs");
const c6 = read("scripts/mvp/admin/validate-c6-integrated-admin.mjs");

const clientSources = [
  "WhatsAppControlCenter",
  "WhatsAppOverviewTab",
  "WhatsAppTemplatesTab",
  "WhatsAppMessagesTab",
  "WhatsAppDeliveryTab",
  "WhatsAppConsentTab",
  "WhatsAppProviderTab",
  "WhatsAppAutomationTab",
].map((name) => read(`components/admin/whatsapp/${name}.tsx`));

const tabMatch = types.match(/export const WHATSAPP_TABS = \[([\s\S]*?)\] as const/);
const declaredTabs = tabMatch
  ? [...tabMatch[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1])
  : [];
const exactTabs = [
  "overview",
  "templates",
  "messages",
  "delivery",
  "consent",
  "provider",
  "automation",
];

// 1 — Existing workspace contract and Provider placement.
check("the seven WhatsApp tabs remain exact", JSON.stringify(declaredTabs) === JSON.stringify(exactTabs));
check("no Billing tab was added", !declaredTabs.includes("billing"));
check("Billing & spend is rendered inside WhatsAppProviderTab", /title="Billing & spend"/.test(provider));
check("the Provider branch alone receives the billing workspace", /<WhatsAppProviderTab workspace=\{payload\.provider\}/.test(shell));
check("C-WA1 historical harness remains present", existsSync(join(root, "scripts/mvp/admin/validate-c-wa1-whatsapp-control-center.mjs")) && cwa1.length > 0);
check("partial C6 integrated harness remains present", existsSync(join(root, "scripts/mvp/admin/validate-c6-integrated-admin.mjs")) && c6.length > 0);

// 2 — Closed source-of-truth model.
check("provider billing_status remains in the exact account projection", /billing_status/.test(serviceCode));
check("stored billingStatus feeds the billing model", /providerAccountBillingFact\(account\.billingStatus\)/.test(serviceCode));
check("billing status names the provider-account source", /source: "quickfurno_provider_account"/.test(serviceCode));
check("unknown financial facts use an explicit unavailable state", /reason: "NOT_AVAILABLE_FROM_CURRENT_INTEGRATION"/.test(serviceCode));
for (const fact of ["model", "currency", "creditLine", "spend", "balance", "paymentMethod"]) {
  check(`${fact} defaults to explicit unavailable`, new RegExp(`${fact}: BILLING_FACT_UNAVAILABLE`).test(serviceCode));
}
check("no unavailable balance or spend falls back to zero", !/balance:\s*[^,]*\?\?\s*0|spend:\s*[^,]*\?\?\s*0/.test(serviceCode));
check("the UI visibly states unavailable financial facts", provider.includes("Not available from current integration"));
check("the UI refuses to assume INR", /No INR or other currency is assumed/.test(provider));
check("no rupee-denominated amount is fabricated", !/₹\s*\d|INR\s*\d/i.test(provider));
check("vendor lead credits are explicitly separated from Meta billing", /vendor lead credits are a separate system/i.test(provider));
check("vendor credit columns never enter the billing read model", !/remaining_credits|vendor_credit_logs|vendor_packages/.test(service));

// 3 — Billing/readiness/authorization distinctions.
check("billing status is not presented as provider readiness", /not a provider-readiness or business-authorization verdict/.test(provider));
check("operator attention is derived only from stored billing status", /Derived only from the stored billing status/.test(provider));
check("provider readiness vocabulary remains intact", [
  "READY",
  "MISSING",
  "INVALID",
  "DISABLED_BY_RUNTIME_POLICY",
  "ACCOUNT_NOT_READY",
  "MAPPING_NOT_READY",
  "CANARY_NOT_READY",
].every((state) => provider.includes(state)));
check("business authorization remains a separate authority", /runtime activation is not business authorization/.test(provider));

// 4 — Recharge, credit-line and management safety.
const nativeRechargeInvariant = (source) =>
  /nativeRecharge:\s*\{\s*supported:\s*false/.test(source) &&
  /NOT_SUPPORTED_BY_CURRENT_QUICKFURNO_INTEGRATION/.test(source);
check("native QuickFurno recharge is explicitly unsupported", nativeRechargeInvariant(serviceCode));
check("the UI has no recharge/top-up control", !/<(button|a)[^>]*>[^<]*(Recharge|Top[- ]?up)/i.test(providerCode));
check("no credit-line attach/share endpoint is present", !/whatsapp_credit_sharing_and_attach|owning_credit_allocation_configs/i.test([serviceCode, route, providerCode].join("\n")));
check("management is guidance-only with no fabricated URL", /mode: "guidance_only"/.test(serviceCode) && /url: null/.test(serviceCode));
check("no billing deep-link anchor or dead CTA is rendered", !/href=|<button/i.test(providerCode));
check("Meta management guidance is visible", /Manage billing in \{billing\.management\.destination\}/.test(provider));

// 5 — Server/auth/security boundaries.
const guardIndex = route.indexOf("const session = await getAdminSession()");
const providerReadIndex = route.indexOf("getWhatsAppProviderReadiness()");
check("auth guard precedes the provider read", guardIndex >= 0 && providerReadIndex > guardIndex);
check("unauthenticated access redirects through normal admin auth", /if \(!session\.isLoggedIn\) redirect\("\/admin\/login"\)/.test(route));
check("superadmin authorization remains required", /if \(!session\.isSuperadmin\) redirect\("\/admin\/login\?error=unauthorized"\)/.test(route));
check("billing projection runs only in the Provider branch", /tab === "provider"[\s\S]{0,500}getWhatsAppProviderBilling\(readiness\)/.test(route) && (route.match(/getWhatsAppProviderBilling\(/g) ?? []).length === 1);
check("hidden tabs remain lazy", exactTabs.filter((tab) => tab !== "messages").every((tab) => new RegExp(`tab === "${tab}"`).test(route)));
check("browser code never calls Meta Graph", clientSources.every((source) => !/graph\.facebook\.com|facebook\.com\/v\d/i.test(source)));
check("browser code never imports the service-role client", clientSources.every((source) => !/adminClient|lib\/supabase/.test(source)));
check("browser code performs no fetch", clientSources.every((source) => !/\bfetch\s*\(/.test(source)));
check("Admin WhatsApp read service contains no write method", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(serviceCode));
check("no billing provider POST/PATCH/DELETE exists", !/method:\s*"(POST|PATCH|DELETE)"/.test([serviceCode, route].join("\n")));
check("no provider activation was added", !/activateProvider|activation_status\s*[:=]\s*["']active/i.test([serviceCode, route, providerCode].join("\n")));
check("no n8n activation was added", !/activateN8n|n8n.*(enable|activate)/i.test([serviceCode, route, providerCode].join("\n")));
check("no WhatsApp send/retry/submit control was added", !/>\s*(Send|Send now|Retry|Resend|Submit to Meta|Activate)\s*</i.test(providerCode));
check("no broad WhatsApp snapshot consumer exists", !/adminSnapshot|whatsappSnapshot/.test([service, route, shell].join("\n")));

// 6 — Presentation scope and migration lock.
check("dark admin tokens remain scoped", /\.admin-surface \{[^}]*--qfa-page/.test(css));
check("Billing & spend reuses scoped qfa surfaces", /qfa-panel/.test(provider) && /qfa-quiet/.test(provider));
const migrations = readdirSync(join(root, "supabase", "migrations")).filter((name) => name.endsWith(".sql"));
// QF-MVP-70.04 RE-PIN: 98 -> 99. The point of this guard is unchanged — THIS admin phase
// added no migration — and the new file belongs to QF-MVP-40 (20260814000000_qf_mvp_40_marketing_consent_writer.sql).
// QF-MVP-75.01 RE-PIN: 99 -> 100. This admin phase still adds no migration of its own;
// the new file belongs to QF-MVP-75.01 (20260815000000_qf_mvp_75_01_matchcore_binding_rank_order.sql).
// QF-MVP-75.02 RE-PIN: 100 -> 101. This phase still adds no migration of its own;
// the geo normalization / PostGIS shortlist foundation (20260816000000) is the only
// addition. Exact equality, never loosened.
check("migration count remains exactly 101", migrations.length === 101);
check("C-WA1B package command is wired", typeof pkg.scripts["test:admin:cwa1b"] === "string");

// 7 — Focused mutation self-tests for the highest-risk claims.
check(
  "self-test kills a native-recharge enablement mutation",
  !nativeRechargeInvariant(
    serviceCode.replace(
      /nativeRecharge:\s*\{\s*supported:\s*false/,
      "nativeRecharge: { supported: true",
    ),
  ),
);
const unavailableFinancialInvariant = (source) =>
  ["model", "currency", "creditLine", "spend", "balance", "paymentMethod"].every((fact) =>
    new RegExp(`${fact}: BILLING_FACT_UNAVAILABLE`).test(source),
  );
check(
  "self-test kills a fabricated zero-balance mutation",
  !unavailableFinancialInvariant(serviceCode.replace("balance: BILLING_FACT_UNAVAILABLE", 'balance: providerAccountBillingFact("0")')),
);

console.log(`\nC-WA1B WhatsApp Billing & spend: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
