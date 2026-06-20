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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Service-role client. SERVER ONLY — throws if used without the key. */
export function adminClient(): SupabaseClient {
  if (!SERVICE) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing (server only).");
  return createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Anon client for public, unauthenticated reads. */
export function publicClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false } });
}

/** Request-scoped client that respects the signed-in user's session (App Router). */
export async function serverClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(URL, ANON, {
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
