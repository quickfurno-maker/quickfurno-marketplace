const dashboardStats = [
  ["Total leads", "86"],
  ["Remaining leads", "14"],
  ["New leads", "8"],
  ["Contacted", "42"],
  ["Converted", "11"],
  ["Rating", "4.8"],
];

export function VendorDashboardPreview() {
  return (
    <div className="dashboard-preview reveal-card">
      {/* Future integration: Android vendor dashboard will read assigned leads from Supabase lead_assignments table. */}
      <div className="dashboard-topbar">
        <span />
        <strong>Vendor Dashboard</strong>
        <em>Active package</em>
      </div>
      <div className="dashboard-stat-grid">
        {dashboardStats.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="dashboard-leads">
        {["Modular kitchen enquiry", "Painting requirement", "Wardrobe project"].map((lead, index) => (
          <div key={lead}>
            <span>{lead}</span>
            <small>{index + 1} hr ago</small>
            <button type="button">Contact</button>
          </div>
        ))}
      </div>
      <button className="btn btn-primary dashboard-renew" type="button">
        Renew package
      </button>
    </div>
  );
}
