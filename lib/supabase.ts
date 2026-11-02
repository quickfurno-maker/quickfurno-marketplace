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
  const { cookies } = await import("next/headers");
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

/**
 * Server-side bearer identity verification at the approved portable Auth boundary.
 * Never treat decoding JWT claims alone as signature verification.
 * VOX consumers separately enforce AAL2, Core role, and live object/city grants.
 */
export async function verifySupabaseBearerUser(token: string) {
  if (!token || token.length > 8192) return null;
  try {
    const auth = createClient(supabaseUrl(), anonKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error } = await auth.auth.getUser(token);
    return error ? null : user;
  } catch {
    return null;
  }
}

/** RC45 approved persistence boundary for the dedicated, read-only EOD reviewer.
 * The caller must independently validate role/expiry. This constructor NEVER
 * derives credentials from service_role, adminClient or the user's session.
 * PostgREST must validate the signed execute-only reader JWT at its boundary.
 */
export function createVoxEodSnapshotReaderTransport(
  input: {url:string;anonKey:string;bearer:string},
): (fn:"qf_vox_rc41_signed_eod_review_snapshot_v1",
     args:{p_intent_id:string;p_subject_id:string})=>Promise<{data:unknown;error:unknown}> {
  // Never allow an empty, header-injectable or public anon-key bearer to
  // masquerade as the dedicated reviewed read-only EOD principal.
  if(typeof input.bearer!=="string"||!input.bearer.trim()||
     /[\r\n\s]/.test(input.bearer)||input.bearer===input.anonKey)
    return async()=>({data:null,error:{message:"EOD_REVIEW_BEARER_INVALID"}});
  const client:SupabaseClient=createClient(input.url,input.anonKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{Authorization:"Bearer "+input.bearer}},
  });
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return async (fn,args)=>{
    if(fn!=="qf_vox_rc41_signed_eod_review_snapshot_v1")
      return {data:null,error:{message:"EOD_REVIEW_FUNCTION_DENIED"}};
    if(!args||!uuid.test(args.p_intent_id||"")||!uuid.test(args.p_subject_id||""))
      return {data:null,error:{message:"EOD_REVIEW_ARGUMENTS_INVALID"}};
    // Bounded read-only EOD HTTP RPC. Timeout never triggers privileged fallback.
    return client.rpc(fn,args).abortSignal(AbortSignal.timeout(3500));
  };
}
