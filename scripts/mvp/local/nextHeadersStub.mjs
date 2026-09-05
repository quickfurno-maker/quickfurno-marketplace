// `lib/supabase.ts` imports next/headers at module scope for serverClient(),
// which only works inside the Next runtime. getVendorAssignedLeads() uses
// adminClient() and never touches it, so the integration harness supplies a stub
// that RESOLVES but THROWS if anything actually calls it — a silent no-op could
// hide a real request-scoped dependency.
export function cookies() {
  throw new Error("next/headers cookies() is not available in the local integration harness");
}
export function headers() {
  throw new Error("next/headers headers() is not available in the local integration harness");
}
