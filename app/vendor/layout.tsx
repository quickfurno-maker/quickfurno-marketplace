import { redirect } from "next/navigation";
import Link from "next/link";
import { getMyRole } from "@/app/actions";
import { Wordmark } from "@/components/Brand";
import { SignOut } from "@/components/SignOut";

export default async function VendorLayout({ children }: { children: React.ReactNode }) {
  const role = await getMyRole();
  if (!role) redirect("/login");
  if (role === "admin") redirect("/admin");

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-navy-ink/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/vendor"><Wordmark className="text-lg" /></Link>
          <div className="flex items-center gap-5">
            <span className="pill">Studio</span>
            <SignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
