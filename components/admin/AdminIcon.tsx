import type { AdminIconName } from "./adminConfig";

type AdminIconProps = {
  name: AdminIconName;
  className?: string;
};

const paths: Record<AdminIconName, string[]> = {
  dashboard: ["M4 5h7v7H4z", "M13 5h7v4h-7z", "M13 11h7v8h-7z", "M4 14h7v5H4z"],
  leads: ["M4 6h16", "M4 12h10", "M4 18h7", "M16 14l2 2 3-4"],
  vendors: ["M7 19v-2a4 4 0 0 1 4-4h2a4 4 0 0 1 4 4v2", "M9 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0", "M5 20h14"],
  packages: ["M4 8l8-4 8 4-8 4z", "M4 8v8l8 4 8-4V8", "M12 12v8"],
  categories: ["M5 5h6v6H5z", "M13 5h6v6h-6z", "M5 13h6v6H5z", "M13 13h6v6h-6z"],
  cities: ["M4 20h16", "M6 20V7l5-3v16", "M14 20V9l4 2v9", "M8 9h1", "M8 13h1", "M15 13h1"],
  payments: ["M4 7h16v10H4z", "M4 10h16", "M7 14h4"],
  distribution: ["M5 12h14", "M12 5l7 7-7 7", "M5 5v14"],
  subscriptions: ["M7 7h10v12H7z", "M9 5h6", "M10 11h4", "M10 15h4"],
  reports: ["M5 19V5h14v14z", "M8 16v-4", "M12 16V8", "M16 16v-6"],
  aos: ["M12 3l7 4v6c0 4-2.7 6.8-7 8-4.3-1.2-7-4-7-8V7z", "M9 12h6", "M12 9v6", "M8 17l8-10"],
  crm: ["M4 6h16v12H4z", "M4 10h16", "M8 14h4", "M8 6v12"],
  analytics: ["M4 20V4", "M4 20h16", "M8 16v-5", "M12 16V8", "M16 16v-8", "M20 16v-3"],
  ai: ["M7 8a5 5 0 0 1 10 0v2a5 5 0 0 1-10 0z", "M9 14l-2 5", "M15 14l2 5", "M10 9h.01", "M14 9h.01"],
  automations: ["M6 12a6 6 0 0 1 10-4", "M18 8V4h-4", "M18 12a6 6 0 0 1-10 4", "M6 16v4h4"],
  content: ["M5 5h14v14H5z", "M8 9h8", "M8 13h6", "M8 17h4"],
  reviews: ["M5 5h14v10H8l-3 3z", "M9 9h6", "M9 12h4"],
  notifications: ["M7 17h10", "M9 17a3 3 0 0 0 6 0", "M8 14V9a4 4 0 0 1 8 0v5l2 3H6z"],
  users: ["M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6", "M3 20a5 5 0 0 1 10 0", "M16 11a3 3 0 1 0 0-6", "M15 15a5 5 0 0 1 6 5"],
  settings: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8", "M12 2v3", "M12 19v3", "M4.93 4.93l2.12 2.12", "M16.95 16.95l2.12 2.12", "M2 12h3", "M19 12h3", "M4.93 19.07l2.12-2.12", "M16.95 7.05l2.12-2.12"],
  audit: ["M6 4h12v16H6z", "M9 8h6", "M9 12h6", "M9 16h4"],
};

export function AdminIcon({ name, className = "h-5 w-5" }: AdminIconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name].map((path, index) => (
        <path key={`${name}-${index}`} d={path} />
      ))}
    </svg>
  );
}
