import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function LegacyVendorMatchingRedirect({
  searchParams,
}: {
  searchParams?: { lead?: string; match?: string; code?: string };
}) {
  const params = new URLSearchParams();
  const feedback = searchParams?.match ?? searchParams?.lead;
  if (feedback) params.set("match", feedback);
  if (searchParams?.code) params.set("code", searchParams.code);
  const query = params.toString();
  redirect(`/vendor/dashboard/matching${query ? `?${query}` : ""}`);
}
