"use client";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";

export function SignOut() {
  const router = useRouter();
  return (
    <button
      onClick={async () => { await browserClient().auth.signOut(); router.refresh(); router.push("/login"); }}
      className="font-sans text-sm text-muted transition hover:text-gold"
    >
      Sign out
    </button>
  );
}
