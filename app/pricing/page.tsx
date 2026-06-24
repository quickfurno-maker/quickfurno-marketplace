import { redirect } from "next/navigation";

// Vendor lead-pack pricing is no longer exposed on a public client route.
// Package details are shared privately with vendors after business verification
// (and inside the vendor dashboard). Any old /pricing link now lands on the
// vendor page where the verification-gated flow lives.
export const metadata = { title: "For Vendors — QuickFurno" };

export default function PricingPage() {
  redirect("/vendors");
}
