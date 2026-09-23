import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyVendorMatchingRedirect(props: {
  searchParams?: Promise<{ lead?: string; match?: string; code?: string }>;
}) {
  // Next 16: searchParams is a Promise. Read synchronously it type-checks,
  // builds clean, then returns undefined at runtime.
  const searchParams = await props.searchParams;
  const params = new URLSearchParams();
  const feedback = searchParams?.match ?? searchParams?.lead;
  if (feedback) params.set("match", feedback);
  if (searchParams?.code) params.set("code", searchParams.code);
  const query = params.toString();
  redirect(`/vendor/dashboard/matching${query ? `?${query}` : ""}`);
}
