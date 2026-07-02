import { getMyVendor } from "@/app/actions";
import { VendorNoProfileFallback } from "./VendorNoProfileFallback";

type VendorPlaceholderPageProps = {
  title: string;
  message: string;
};

export async function VendorPlaceholderPage({ title, message }: VendorPlaceholderPageProps) {
  const me = await getMyVendor();
  const vendor = me.ok ? me.data : null;

  if (!vendor) {
    return <VendorNoProfileFallback />;
  }

  return (
    <section className="qf-vd-page">
      <div className="qf-vd-card">
        <h1 className="qf-vd-card-title">{title}</h1>
        <div className="qf-vd-empty">
          <p>{message}</p>
        </div>
      </div>
    </section>
  );
}
