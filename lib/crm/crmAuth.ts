// ============================================================================
// QF-MVP-30.2 — server-only Vendor CRM authorization guard.
//
// SERVER ONLY (imports serverClient → next/headers cookies). Every CRM read and
// mutation must pass through requireCrmAdmin() BEFORE any service_role client is
// created. Founder/admin only for V1: canonical profiles.role = 'admin' AND the
// server-controlled app_metadata.admin_role = 'Superadmin' (the same boundary the
// existing privileged admin writes use). Role/actor are NEVER taken from request
// input, user_metadata, email, phone, or a browser-hidden field.
// ============================================================================

import { serverClient } from "../supabase";
import { appError } from "../errors";

export interface CrmAdminActor {
  /** auth.users.id of the authorized admin — the sole source of CRM actor fields. */
  id: string;
  adminRole: string | null;
}

export async function requireCrmAdmin(): Promise<CrmAdminActor> {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw appError("UNAUTHORIZED");

  // canonical role authority: read the server-owned profiles.role (never metadata).
  const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).single();
  const role = (profile?.role ?? undefined) as string | undefined;
  const adminRole = (user.app_metadata?.admin_role as string | undefined) ?? null;

  if (role !== "admin" || adminRole !== "Superadmin") throw appError("UNAUTHORIZED");
  return { id: user.id, adminRole };
}
