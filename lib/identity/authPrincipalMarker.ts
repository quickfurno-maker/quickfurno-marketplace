// ============================================================================
// QuickFurno — lib/identity/authPrincipalMarker.ts   (pure, dependency-free)
//
// THE TRUSTED AUTH PRINCIPAL MARKER (QF-MVP-20.3DR1)
//
// public.handle_new_user() classifies a NEW auth.users row into a profile role.
// It must never take that classification from `user_metadata`, because
// `user_metadata` is written verbatim from the client-supplied `options.data`
// of a public `POST /auth/v1/signup` and is therefore attacker-controlled.
//
// The marker lives in Supabase Auth **app_metadata** instead:
//
//   • app_metadata is NOT settable by an anonymous or an authenticated caller.
//     `auth.signUp({ options: { data } })` and `auth.updateUser({ data })` both
//     write user_metadata only; GoTrue exposes no non-admin route to
//     app_metadata. Only the Admin API — `auth.admin.createUser` /
//     `auth.admin.updateUserById`, which require the service-role key — can set
//     it, and the service-role key is server-only.
//   • The database sees it as `auth.users.raw_app_meta_data`, which is what the
//     trigger reads. `raw_user_meta_data` is never consulted for classification.
//
// ABSENT OR UNKNOWN MARKER IS NOT AN ERROR AND NOT A VENDOR. It yields the
// NEUTRAL profile role (SQL NULL) — a row with no privilege of any kind. Only
// an exact `qf_principal === "vendor"` produces the vendor classification, and
// NOTHING in this file (or in the trigger) can ever produce the administrator
// role: admin is granted solely by the deliberate service-role operator path
// (scripts/grant-superadmin.mjs), never by signup.
// ============================================================================

/** The single app_metadata key the onboarding trigger reads. Server-set only. */
export const QF_PRINCIPAL_APP_METADATA_KEY = "qf_principal";

/** The only marker value that classifies a new auth user as a vendor. */
export const QF_PRINCIPAL_VENDOR = "vendor";

/**
 * The app_metadata block for a SERVER-CREATED vendor account. Use this as the
 * `app_metadata` of `auth.admin.createUser` in the vendor registration path so
 * the trigger's read and the runtime's write can never drift apart.
 *
 * Never call this from a browser module: setting app_metadata requires the
 * service-role key, which is server-only.
 */
export function vendorPrincipalAppMetadata(): Readonly<Record<string, string>> {
  return { [QF_PRINCIPAL_APP_METADATA_KEY]: QF_PRINCIPAL_VENDOR };
}
