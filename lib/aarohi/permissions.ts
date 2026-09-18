import type { AarohiPermission } from "./contracts";
export type QuickFurnoAdminRole = "Superadmin"|"Sales Admin"|"Support Admin"|"Finance Admin"|"Content Admin"|"Operations Admin";
const ALL: AarohiPermission[] = ["aarohi.view","aarohi.manage","aarohi.takeover","aarohi.suppress","aarohi.review_identity","aarohi.manage_campaigns","aarohi.view_analytics","aarohi.export"];
const ROLE_PERMISSIONS: Record<QuickFurnoAdminRole, readonly AarohiPermission[]> = {
  "Superadmin": ALL,
  "Sales Admin": ["aarohi.view","aarohi.manage","aarohi.takeover","aarohi.suppress","aarohi.review_identity","aarohi.manage_campaigns","aarohi.view_analytics","aarohi.export"],
  "Operations Admin": ["aarohi.view","aarohi.manage","aarohi.takeover","aarohi.suppress","aarohi.review_identity","aarohi.view_analytics"],
  "Support Admin": ["aarohi.view","aarohi.takeover"],
  "Finance Admin": ["aarohi.view","aarohi.view_analytics"],
  "Content Admin": ["aarohi.view"],
};
export function aarohiPermissionsForRole(role: string|null|undefined): ReadonlySet<AarohiPermission> { return new Set(role && role in ROLE_PERMISSIONS ? ROLE_PERMISSIONS[role as QuickFurnoAdminRole] : []); }
export function hasAarohiPermission(role: string|null|undefined, permission: AarohiPermission): boolean { return aarohiPermissionsForRole(role).has(permission); }
