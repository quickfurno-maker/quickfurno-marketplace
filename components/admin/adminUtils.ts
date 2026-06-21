import type { Assignment, Lead, PackageRow, Payment, Vendor } from "./adminTypes";

export function formatNumber(value: unknown) {
  return new Intl.NumberFormat("en-IN").format(Number(value ?? 0));
}

export function formatINR(value: unknown) {
  return `INR ${formatNumber(value)}`;
}

export function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function shortId(value?: string | null) {
  return value ? value.slice(0, 8).toUpperCase() : "N/A";
}

export function groupBy<T>(rows: T[], mapper: (row: T) => unknown) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const label = String(mapper(row) ?? "").trim() || "Unknown";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));
}

export function groupLeadsByDate(leads: Lead[]) {
  return groupBy(leads, (lead) => formatDate(lead.created_at));
}

export function revenueByPackage(payments: Payment[], packages: PackageRow[]) {
  const names = new Map(packages.map((item) => [item.id, item.name || "Package"]));
  const paid = payments.filter((payment) => (payment.payment_status || "").toLowerCase() === "paid");
  const totals = new Map<string, number>();

  paid.forEach((payment) => {
    const label = names.get(payment.package_id || "") || "Manual payment";
    totals.set(label, (totals.get(label) ?? 0) + Number(payment.amount ?? 0));
  });

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({ label, value }));
}

export function vendorName(vendors: Vendor[], id?: string | null) {
  return vendors.find((vendor) => vendor.id === id)?.business_name || shortId(id);
}

export function packageName(packages: PackageRow[], id?: string | null) {
  return packages.find((item) => item.id === id)?.name || shortId(id);
}

export function leadName(leads: Lead[], id?: string | null) {
  return leads.find((lead) => lead.id === id)?.name || shortId(id);
}

export function assignmentStatus(assignment: Assignment) {
  return assignment.vendor_status || assignment.assignment_type || "Assigned";
}

export function includesQuery(values: Array<unknown>, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

export function uniqueOptions(values: Array<unknown>, fallback = "All") {
  const options = new Set<string>([fallback]);
  values.forEach((value) => {
    const label = String(value ?? "").trim();
    if (label) options.add(label);
  });
  return [...options];
}
