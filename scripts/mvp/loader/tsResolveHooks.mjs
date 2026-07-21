// ============================================================================
// QF-MVP-00 — Minimal, safe TypeScript resolution hook for the MVP test runner.
//
// WHY THIS EXISTS
// Node v24 runs `.ts` files directly via native type-stripping, but it does NOT
// auto-resolve *extensionless* relative import specifiers to a `.ts` file. A few
// pure production modules (e.g. providers/providerOutcome.ts,
// providers/metaWhatsAppWebhook.ts) import siblings as `./x` (no extension). This
// hook lets those real modules load unchanged so the MVP suites can test the
// ACTUAL production code — never a copy.
//
// SAFETY PROPERTIES (deliberate and load-bearing):
//   1. It ONLY ever appends a `.ts` extension to *relative* specifiers ("./x",
//      "../x") that failed normal resolution. It never rewrites bare specifiers.
//   2. It NEVER maps the "@/..." path alias. Modules that reach for "@/lib/..."
//      (services, the Supabase client, runtime config) therefore stay UNRESOLVED
//      and fail loudly — they can never be pulled into an "offline" suite by
//      accident. This is the primary guard that keeps the runner DB/network-free.
//   3. As defence-in-depth it refuses to `.ts`-resolve any specifier whose path
//      points at a Supabase or services module.
//   4. It resolves normally first and only falls back on ERR_MODULE_NOT_FOUND, so
//      it can never shadow a specifier Node already resolves correctly.
// ============================================================================

const RELATIVE = /^\.\.?\//;
const HAS_EXTENSION = /\.[a-z0-9]+$/i;
const FORBIDDEN = /(^|\/)(supabase|services)(\/|$)/i;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const code = err && err.code;
    const isMissing = code === 'ERR_MODULE_NOT_FOUND' || code === 'ERR_UNSUPPORTED_DIR_IMPORT';
    if (isMissing && RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier)) {
      if (FORBIDDEN.test(specifier)) {
        throw new Error(
          `[qf-mvp-loader] Refusing to resolve "${specifier}" — the MVP runner must ` +
            `not import Supabase/services modules (they perform I/O).`,
        );
      }
      // Only try appending `.ts`. Any remaining failure surfaces loudly.
      return await nextResolve(`${specifier}.ts`, context);
    }
    throw err;
  }
}
