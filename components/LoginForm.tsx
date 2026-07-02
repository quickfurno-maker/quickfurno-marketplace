"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";

export function LoginForm() {
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
      <p className="mt-4 text-center font-sans text-xs text-muted">
        New studio? <a href="/vendors/register" className="text-gold hover:underline">Apply to join</a>
      </p>
    </div>
  );
}
