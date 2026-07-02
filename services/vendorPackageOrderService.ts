// ============================================================================
// QuickFurno - services/vendorPackageOrderService.ts
// Vendor-created package order intents. This service deliberately does not
// activate packages, mark payments paid, or add credits.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";

export type VendorPackageOption = {
  id: string;
  name: string;
  lead_count: number;
  total_price: number;
  display_price: number;
  validity_days: number;
  is_active: boolean;
};

export type VendorCurrentPackageSummary = {
  remaining_credits: number;
  total_credits: number;
  package_name: string | null;
  package_status: string | null;
  package_expires_at: string | null;
  active_package: {
    id: string;
    package_id: string | null;
    total_leads: number | null;
    remaining_leads: number | null;
    expiry_date: string | null;
    status: string | null;
    payment_status: string | null;
  } | null;
};

export type VendorPackageOrder = {
  id: string;
  vendor_id: string;
  package_id: string | null;
  package_name: string | null;
  package_price: number | null;
  package_currency: string | null;
  credits_included: number | null;
  validity_days: number | null;
  order_status: string | null;
  payment_status: string | null;
  payment_method: string | null;
  payment_provider: string | null;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  paid_at: string | null;
  activated_at: string | null;
  activation_status: string | null;
  failure_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function listAvailableVendorPackages(): Promise<Result<VendorPackageOption[]>> {
  try {
    const { data, error } = await adminClient()
      .from("packages")
      .select("id, name, lead_count, total_price, display_price, validity_days, is_active")
      .eq("is_active", true)
      .order("lead_count", { ascending: true });

    if (error) throw error;
    return ok((data ?? []) as VendorPackageOption[]);
  } catch (e) {
    return fail(e);
  }
}

export async function getVendorCurrentPackageSummary(vendorId: string): Promise<Result<VendorCurrentPackageSummary>> {
  try {
    const db = adminClient();
    const [vendorRes, activePackageRes] = await Promise.all([
      db
        .from("vendors")
        .select("remaining_credits, total_credits, package_name, package_status, package_expires_at")
        .eq("id", vendorId)
        .maybeSingle(),
      db
        .from("vendor_packages")
        .select("id, package_id, total_leads, remaining_leads, expiry_date, status, payment_status")
        .eq("vendor_id", vendorId)
        .eq("status", "Active")
        .order("purchase_date", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (vendorRes.error) throw vendorRes.error;
    if (!vendorRes.data) throw appError("UNAUTHORIZED");
    if (activePackageRes.error) throw activePackageRes.error;

    return ok({
      remaining_credits: Number(vendorRes.data.remaining_credits ?? 0),
      total_credits: Number(vendorRes.data.total_credits ?? 0),
      package_name: vendorRes.data.package_name ?? null,
      package_status: vendorRes.data.package_status ?? null,
      package_expires_at: vendorRes.data.package_expires_at ?? null,
      active_package: (activePackageRes.data as VendorCurrentPackageSummary["active_package"]) ?? null,
    });
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorPackageOrder(vendorId: string, packageId: string): Promise<Result<VendorPackageOrder>> {
  try {
    if (!vendorId || !packageId) throw appError("VALIDATION");

    const db = adminClient();
    const { data: pkg, error: pkgError } = await db
      .from("packages")
      .select("id, name, lead_count, total_price, display_price, validity_days, is_active")
      .eq("id", packageId)
      .eq("is_active", true)
      .maybeSingle();

    if (pkgError) throw pkgError;
    if (!pkg) throw appError("PACKAGE_NOT_FOUND");

    const { data, error } = await db
      .from("vendor_package_orders")
      .insert({
        vendor_id: vendorId,
        package_id: pkg.id,
        package_name: pkg.name,
        package_price: pkg.total_price ?? pkg.display_price ?? null,
        package_currency: "INR",
        credits_included: pkg.lead_count ?? null,
        validity_days: pkg.validity_days ?? null,
        order_status: "created",
        payment_status: "not_started",
        payment_method: "online_future",
        payment_provider: "not_connected",
        activation_status: "not_activated",
      })
      .select("*")
      .single();

    if (error) throw error;
    return ok(data as VendorPackageOrder);
  } catch (e) {
    return fail(e);
  }
}

export async function listVendorPackageOrders(vendorId: string): Promise<Result<VendorPackageOrder[]>> {
  try {
    const { data, error } = await adminClient()
      .from("vendor_package_orders")
      .select("*")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return ok((data ?? []) as VendorPackageOrder[]);
  } catch (e) {
    return fail(e);
  }
}
