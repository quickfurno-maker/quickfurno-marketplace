import { vendorSubmitProfileChangeRequest } from "@/app/actions";
import { getMyVendor } from "@/app/actions";
import { VendorNoProfileFallback } from "@/app/vendor/dashboard/_components/VendorNoProfileFallback";
import {
  getVendorApprovedProfileSummary,
  listVendorProfileChangeRequests,
} from "@/services/vendorProfileChangeService";

export const metadata = { title: "Vendor profile approval - QuickFurno" };
export const dynamic = "force-dynamic";

const categories = [
  "Interior Designers",
  "Carpenters",
  "Modular Factory",
  "Premium Interiors",
  "Sofa",
  "Painter",
  "Civil Work",
];

type VendorProfileApprovalPageProps = {
  searchParams?: {
    request?: string;
    code?: string;
  };
};

export default async function VendorProfileApprovalPage({ searchParams }: VendorProfileApprovalPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  const [summaryRes, requestsRes] = await Promise.all([
    getVendorApprovedProfileSummary(vendor.id),
    listVendorProfileChangeRequests(vendor.id),
  ]);

  const summary = summaryRes.ok ? summaryRes.data : null;
  const requests = requestsRes.ok ? requestsRes.data : [];
  const pending = requests.find((request) => request.status === "pending");
  const rejected = requests.find((request) => request.status === "rejected");
  const current = {
    businessName: summary?.business_name ?? vendor.business_name ?? "",
    description: summary?.public_description ?? "",
    category: summary?.selected_category ?? vendor.selected_category ?? (summary?.service_categories ?? vendor.service_categories ?? [])[0] ?? "",
    services: (summary?.service_categories ?? vendor.service_categories ?? []).join("\n"),
    startingPrice: summary?.starting_price ?? "",
    businessHours: summary?.public_business_hours ?? "",
    serviceAreaSummary: summary?.public_service_area_summary ?? (vendor.areas_covered ?? []).join(", "),
    profileImageUrl: summary?.profile_image_url ?? "",
    coverImageUrl: summary?.cover_image_url ?? "",
    portfolioImageUrls: (summary?.portfolio_urls ?? []).join("\n"),
  };

  return (
    <section className="qf-vd-page">
      {searchParams?.request === "submitted" ? (
        <div className="qf-vd-card qf-vd-note--pending">
          Profile change request submitted. Approved changes will go live after admin review.
        </div>
      ) : null}

      {searchParams?.request === "failed" ? (
        <div className="qf-vd-card qf-vd-note--pending">
          Profile change request could not be submitted. Please check the form and try again.
        </div>
      ) : null}

      <div className="qf-vd-card qf-vd-welcome">
        <div>
          <h1>Profile Approval</h1>
          <p>Submit public profile changes for QuickFurno approval. Your live public listing is not updated until an admin approves the request.</p>
        </div>
      </div>

      <div className="qf-vd-card">
        <h2 className="qf-vd-card-title">Current approved profile summary</h2>
        <div className="qf-vd-profile-summary">
          <ProfileField label="Public business name/title" value={current.businessName} />
          <ProfileField label="Public category" value={current.category} />
          <ProfileField label="Starting price" value={current.startingPrice || "Not set"} />
          <ProfileField label="Business hours" value={current.businessHours || "Not set"} />
          <ProfileField label="Service area summary" value={current.serviceAreaSummary || "Not set"} />
          <ProfileField label="Public description" value={current.description || "Not set"} />
        </div>
      </div>

      {pending ? (
        <div className="qf-vd-card qf-vd-note--pending">
          You already have a pending profile change request from {formatDate(pending.created_at)}. It must be reviewed before changes go live.
        </div>
      ) : null}

      {rejected ? (
        <div className="qf-vd-card qf-vd-note--pending">
          Latest rejected request: {rejected.rejection_reason || "No rejection reason provided."}
        </div>
      ) : null}

      <form action={vendorSubmitProfileChangeRequest} className="qf-vd-card qf-vd-profile-form">
        <h2 className="qf-vd-card-title">Request public profile changes</h2>
        <label>
          <span>Public business name/title</span>
          <input name="public_business_name" defaultValue={current.businessName} />
        </label>
        <label>
          <span>Public description</span>
          <textarea name="public_description" defaultValue={current.description} rows={5} />
        </label>
        <label>
          <span>Public category</span>
          <select name="public_category" defaultValue={current.category}>
            <option value="">Select category</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Services offered</span>
          <textarea name="services_offered" defaultValue={current.services} rows={5} />
        </label>
        <label>
          <span>Starting price</span>
          <input name="starting_price" defaultValue={current.startingPrice} />
        </label>
        <label>
          <span>Business hours</span>
          <input name="business_hours" defaultValue={current.businessHours} />
        </label>
        <label>
          <span>Service area summary</span>
          <input name="service_area_summary" defaultValue={current.serviceAreaSummary} />
        </label>
        <label>
          <span>Profile image URL</span>
          <input name="profile_image_url" defaultValue={current.profileImageUrl} />
        </label>
        <label>
          <span>Cover image URL</span>
          <input name="cover_image_url" defaultValue={current.coverImageUrl} />
        </label>
        <label>
          <span>Portfolio image URLs</span>
          <textarea name="portfolio_image_urls" defaultValue={current.portfolioImageUrls} rows={5} />
        </label>
        <button type="submit" className="qf-vd-btn qf-vd-btn--primary">Submit for approval</button>
      </form>
    </section>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
