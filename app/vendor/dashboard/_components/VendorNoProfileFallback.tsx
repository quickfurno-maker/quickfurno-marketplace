import Link from "next/link";

export function VendorNoProfileFallback() {
  return (
    <div className="qf-vd-empty-profile">
      <h1>No vendor profile yet</h1>
      <p>
        Your account isn't linked to a vendor profile yet. Complete your application to get
        started -- our team will verify your details and enable dashboard access.
      </p>
      <Link href="/vendors/register" className="qf-vd-btn qf-vd-btn--primary">
        Complete application
      </Link>
    </div>
  );
}
