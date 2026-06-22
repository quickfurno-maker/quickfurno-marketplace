// ============================================================================
// QuickFurno — grant Superadmin access to a Supabase Auth user
//
// The admin dashboard guard (components/AdminLoginForm.tsx + app/actions.ts)
// allows a user in only when BOTH are true:
//   1. profiles.role === 'admin'
//   2. auth user's app_metadata.admin_role === 'Superadmin'
//
// There is NO email allowlist in code — access is granted by setting this data.
// This script sets both, using the service-role key. It never stores a password
// in code: the user signs in with their normal Supabase Auth password.
//
// Usage (PowerShell):
//   node scripts/grant-superadmin.mjs quickfurno@gmail.com
//
// If the auth user does not exist yet, create it first (one-time) by also
// passing a password via env so nothing is hardcoded in the repo:
//   $env:SEED_ADMIN_PASSWORD="your-strong-password"; node scripts/grant-superadmin.mjs quickfurno@gmail.com
// (You can change/reset this password anytime from the Supabase dashboard.)
// ============================================================================
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const email = (process.argv[2] || "quickfurno@gmail.com").trim().toLowerCase();

const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) {
  console.error("Missing required env variables:", missing.join(", "));
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function findUserByEmail(target) {
  // listUsers is paginated; walk pages until we find the email.
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => (u.email || "").toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 200) break; // last page
  }
  return null;
}

let user = await findUserByEmail(email);

if (!user) {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    console.error(
      `\nNo Supabase Auth user found for "${email}".\n` +
        `Either create the user once in the Supabase dashboard (Authentication → Users),\n` +
        `or re-run this script with a one-time password via env:\n` +
        `  $env:SEED_ADMIN_PASSWORD="your-strong-password"; node scripts/grant-superadmin.mjs ${email}\n`
    );
    process.exit(1);
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { admin_role: "Superadmin" },
    user_metadata: { role: "admin", full_name: "QuickFurno Admin" },
  });
  if (error) {
    console.error("Failed to create user:", error.message);
    process.exit(1);
  }
  user = data.user;
  console.log(`Created auth user ${email} (${user.id}).`);
}

// 1) Ensure auth app_metadata.admin_role = 'Superadmin'
{
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata || {}), admin_role: "Superadmin" },
  });
  if (error) {
    console.error("Failed to set app_metadata.admin_role:", error.message);
    process.exit(1);
  }
}

// 2) Ensure profiles row: role = 'admin', admin_role = 'Superadmin'
{
  const { error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: user.id,
        role: "admin",
        admin_role: "Superadmin",
        full_name: user.user_metadata?.full_name || "QuickFurno Admin",
        is_active: true,
      },
      { onConflict: "id" }
    );
  if (error) {
    console.error("Failed to upsert profile:", error.message);
    process.exit(1);
  }
}

console.log(`\n✓ ${email} is now a Superadmin.`);
console.log(`  - auth app_metadata.admin_role = "Superadmin"`);
console.log(`  - profiles.role = "admin", profiles.admin_role = "Superadmin"`);
console.log(`Sign in at /admin/login with this email and its Supabase Auth password.`);
