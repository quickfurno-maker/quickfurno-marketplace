"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";

// Role-based sign-in used by the vendor portal (/vendor). The redirect stays
// role-based: admins go to /admin/dashboard even if they sign in here, everyone
// else goes to /vendor/dashboard. The signup link is configurable so the same
// form can point vendors at the portal's signup tab.
export function LoginForm({
  signupHref = "/vendor?mode=signup",
  signupLabel = "Create a vendor account",
  showSignupLink = true,
}: {
  signupHref?: string;
  signupLabel?: string;
  showSignupLink?: boolean;
} = {}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null); setBusy(true);
    const sb = browserClient();
    const { data, error: e } = await sb.auth.signInWithPassword({ email, password });
    if (e) { setError(e.message); setBusy(false); return; }

    const { data: profile } = await sb.from("profiles").select("role").eq("id", data.user.id).single();
    const isAdmin = profile?.role === "admin";

    router.refresh();
    // If an admin signs in from the vendor portal by mistake, still send them to
    // the admin dashboard; vendors go to their dashboard.
    router.push(isAdmin ? "/admin/dashboard" : "/vendor/dashboard");
  }

  return (
    <div className="panel mx-auto max-w-md p-8">
      {error && <p className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 font-sans text-sm text-red-200">{error}</p>}
      <label className="block"><span className="label">Email</span>
        <input className="field" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" onKeyDown={(e) => e.key === "Enter" && onSubmit()} />
      </label>
      <label className="mt-4 block"><span className="label">Password</span>
        <input className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} />
      </label>
      <button onClick={onSubmit} disabled={busy} className="btn-gold mt-6 w-full">{busy ? "Signing in…" : "Sign in"}</button>
      {showSignupLink ? (
        <p className="mt-4 text-center font-sans text-xs text-muted">
          New to QuickFurno? <a href={signupHref} className="text-gold hover:underline">{signupLabel}</a>
        </p>
      ) : null}
    </div>
  );
}
