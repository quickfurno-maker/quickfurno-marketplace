import { redirect } from "next/navigation";
import Link from "next/link";
import { getMyRole } from "@/app/actions";
import { Wordmark } from "@/components/Brand";
import { SignOut } from "@/components/SignOut";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const role = await getMyRole();
  if (!role) redirect("/login");
  if (role !== "admin") redirect("/vendor");

  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-navy-ink/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/admin"><Wordmark className="text-lg" /></Link>
          <div className="flex items-center gap-5">
            <span className="pill chip-on">Admin</span>
            <SignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
    </div>
  );
}
