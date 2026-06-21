// ============================================================================
// QuickFurno — lib/supabase.ts
// Three clients, used deliberately:
//   • adminClient   — service role, SERVER ONLY. Bypasses RLS. Never import in
//                     a client component. Used for privileged writes & RPCs.
//   • publicClient  — anon key. Safe public reads (eligible vendors, packages).
//   • serverClient  — request-scoped, carries the user's session cookie so
//                     RLS + auth.uid() work for vendor/admin scoped queries.
// ============================================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function supabaseUrl() {
  return requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
}

function anonKey() {
  return requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

function serviceRoleKey() {
  return requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
}

/** Service-role client. SERVER ONLY — throws if used without the key. */
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Anon client for public, unauthenticated reads. */
export function publicClient(): SupabaseClient {
  return createClient(supabaseUrl(), anonKey(), { auth: { persistSession: false } });
}

/** Request-scoped client that respects the signed-in user's session (App Router). */
export async function serverClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(supabaseUrl(), anonKey(), {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items: { name: string; value: string; options?: Record<string, unknown> }[]) => {
        try {
          items.forEach(({ name, value, options }: { name: string; value: string; options?: Record<string, unknown> }) => store.set(name, value, options));
        } catch {
          /* called from a Server Component — safe to ignore */
        }
      },
    },
  });
}
