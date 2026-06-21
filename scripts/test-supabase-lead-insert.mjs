import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");

if (existsSync(envPath)) {
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error("Missing required env variables:", missing.join(", "));
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const now = new Date().toISOString();
const payload = {
  name: "QuickFurno Smoke Test",
  phone: "+910000000000",
  city: "Pune",
  area: "Smoke Test",
  service_required: "Modular Kitchen",
  budget: "Smoke Test",
  property_type: "Smoke Test",
  timeline: "Smoke Test",
  message: `Automated Supabase insert smoke test at ${now}. Safe to delete.`,
  source: "Smoke Test",
  verification_status: "Verified",
  status: "New",
  is_duplicate: false,
};

function logFailure(label, error) {
  console.error(label, {
    table: "leads",
    code: error?.code,
    message: error?.message,
    hint: error?.hint,
    status: error?.status ?? error?.statusCode,
  });
}

const { error: duplicateCheckError } = await supabase.rpc("check_duplicate_lead", {
  p_phone: payload.phone,
  p_service: payload.service_required,
  p_city: payload.city,
});

if (duplicateCheckError) {
  logFailure("Supabase duplicate-check RPC failed.", duplicateCheckError);
  process.exit(1);
}

const { data, error } = await supabase
  .from("leads")
  .insert(payload)
  .select("id")
  .single();

if (error) {
  logFailure("Supabase lead insert failed.", error);
  process.exit(1);
}

console.log(`Inserted test lead into leads: ${data.id}`);

if (process.argv.includes("--keep")) {
  console.log("Keeping test lead because --keep was provided.");
  process.exit(0);
}

const { error: deleteError } = await supabase.from("leads").delete().eq("id", data.id);
if (deleteError) {
  logFailure("Supabase test lead cleanup failed.", deleteError);
  process.exit(1);
}

console.log("Deleted test lead after successful insert verification.");
