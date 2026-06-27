export type AdminSectionKey =
  | "dashboard"
  | "leads"
  | "vendors"
  | "packages"
  | "categories"
  | "cities"
  | "payments"
  | "lead-distribution"
  | "vendor-subscriptions"
  | "reports"
  | "aos"
  | "crm"
  | "analytics"
  | "ai-agents"
  | "automations"
  | "website-content"
  | "reviews"
  | "notifications"
  | "users"
  | "settings"
  | "audit-logs";

export type AdminIconName =
  | "dashboard"
  | "leads"
  | "vendors"
  | "packages"
  | "categories"
  | "cities"
  | "payments"
  | "distribution"
  | "subscriptions"
  | "reports"
  | "aos"
  | "crm"
  | "analytics"
  | "ai"
  | "automations"
  | "content"
  | "reviews"
  | "notifications"
  | "users"
  | "settings"
  | "audit";

export type AdminSectionConfig = {
  key: AdminSectionKey;
  href: string;
  label: string;
  description: string;
  icon: AdminIconName;
  addLabel: string;
};

export type AdminNavGroup = {
  title: string;
  sections: AdminSectionKey[];
};

export const adminSections: AdminSectionConfig[] = [
  { key: "dashboard", href: "/admin/dashboard", label: "Dashboard", description: "Marketplace command center", icon: "dashboard", addLabel: "Add Lead" },
  { key: "leads", href: "/admin/leads", label: "Leads", description: "Pipeline, assignments, follow-ups", icon: "leads", addLabel: "Add Lead" },
  { key: "vendors", href: "/admin/vendors", label: "Vendors", description: "Studios, vendors, verification", icon: "vendors", addLabel: "Add Vendor" },
  { key: "packages", href: "/admin/packages", label: "Packages", description: "Lead packs, pricing, visibility", icon: "packages", addLabel: "Add Package" },
  { key: "categories", href: "/admin/categories", label: "Categories", description: "Services and subcategories", icon: "categories", addLabel: "Add Category" },
  { key: "cities", href: "/admin/cities", label: "Cities & Locations", description: "Cities, localities, launch status", icon: "cities", addLabel: "Add City" },
  { key: "payments", href: "/admin/payments", label: "Payments", description: "Collections and renewals", icon: "payments", addLabel: "Add Payment" },
  { key: "lead-distribution", href: "/admin/lead-distribution", label: "Lead Distribution", description: "Rules, logs, eligibility", icon: "distribution", addLabel: "Assign Leads" },
  { key: "vendor-subscriptions", href: "/admin/vendor-subscriptions", label: "Vendor Subscriptions", description: "Credits, expiry, renewals", icon: "subscriptions", addLabel: "Renew Package" },
  { key: "reports", href: "/admin/reports", label: "Reports", description: "Exports and business views", icon: "reports", addLabel: "Export Report" },
  { key: "aos", href: "/admin/aos", label: "AOS Control Center", description: "Agents, versions, tests, approvals", icon: "aos", addLabel: "Create Draft" },
  { key: "crm", href: "/admin/crm", label: "CRM", description: "Pipeline, follow-ups, nurture, calendar", icon: "crm", addLabel: "Add Lead" },
  { key: "analytics", href: "/admin/analytics", label: "Analytics", description: "Sources, funnel, services, revenue", icon: "analytics", addLabel: "Export Analytics" },
  { key: "ai-agents", href: "/admin/ai-agents", label: "AI Agents", description: "Future AI control center", icon: "ai", addLabel: "Create Agent" },
  { key: "automations", href: "/admin/automations", label: "Automations", description: "Webhooks and workflows", icon: "automations", addLabel: "Create Automation" },
  { key: "website-content", href: "/admin/website-content", label: "Website Content", description: "CMS-ready content blocks", icon: "content", addLabel: "Save Content" },
  { key: "reviews", href: "/admin/reviews", label: "Reviews & Ratings", description: "Moderation and trust signals", icon: "reviews", addLabel: "Add Review" },
  { key: "notifications", href: "/admin/notifications", label: "Notifications", description: "Admin alerts and inbox", icon: "notifications", addLabel: "Mark All Read" },
  { key: "users", href: "/admin/users", label: "Admin Users", description: "Roles and access control", icon: "users", addLabel: "Add Admin" },
  { key: "settings", href: "/admin/settings", label: "Settings", description: "Global marketplace controls", icon: "settings", addLabel: "Save Settings" },
  { key: "audit-logs", href: "/admin/audit-logs", label: "Audit Logs", description: "Sensitive action history", icon: "audit", addLabel: "Export Logs" },
];

export const adminNavGroups: AdminNavGroup[] = [
  {
    title: "Command Center",
    sections: ["dashboard", "crm", "leads", "vendors"],
  },
  {
    title: "Business Setup",
    sections: ["packages", "categories", "cities", "payments", "lead-distribution", "vendor-subscriptions"],
  },
  {
    title: "Automation",
    sections: ["analytics", "aos", "ai-agents", "automations", "reports"],
  },
  {
    title: "System",
    sections: ["website-content", "reviews", "notifications", "users", "settings", "audit-logs"],
  },
];

export function getAdminSectionByKey(key: AdminSectionKey) {
  return adminSections.find((section) => section.key === key) ?? adminSections[0];
}

export function getAdminSectionByPath(pathname: string) {
  return adminSections.find((section) => pathname === section.href || pathname.startsWith(`${section.href}/`)) ?? adminSections[0];
}

export function getAdminSectionBySlug(slug: string) {
  return adminSections.find((section) => section.key === slug);
}
