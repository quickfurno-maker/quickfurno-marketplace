import { notFound } from "next/navigation";
import { requireVendorAccess } from "@/services/vendorAccessService";
import { anishaMemoryConsentStagingEnabled } from "@/lib/jarvis/anishaMemoryConsentContract";
import { AnishaMemoryConsentPanel } from "@/components/vendor-dashboard-v2/AnishaMemoryConsentPanel";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Anisha Memory Preferences (Staging) | QuickFurno",
};

export default async function AnishaVendorMemoryPreferences() {
  // Nothing leaks through the public vendor portal or production routes.
  if (!anishaMemoryConsentStagingEnabled()) notFound();
  const access = await requireVendorAccess();
  if (!access.ok) notFound();
  return <AnishaMemoryConsentPanel />;
}
