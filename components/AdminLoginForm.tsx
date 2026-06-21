"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";

type AdminLoginFormProps = {
  initialError?: string;
};

export function AdminLoginForm({ initialError }: AdminLoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const sb = browserClient();
    const { data, error: signInError } = await sb.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError || !data.user) {
      setError(signInError?.message ?? "Could not sign in.");
      setBusy(false);
      return;
    }

    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    const isSuperadmin =
      profile?.role === "admin" && data.user.app_metadata?.admin_role === "Superadmin";

    if (profileError || !isSuperadmin) {
      await sb.auth.signOut();
      setError("Only Superadmin users can access this dashboard.");
      setBusy(false);
      return;
    }

    router.refresh();
    router.replace("/admin/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef2f7] px-5 py-10 text-[#111827]">
      <section className="w-full max-w-md rounded-[28px] border border-white/80 bg-white p-7 shadow-[0_30px_90px_rgba(15,23,42,0.14)]">
        <div className="mb-7">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#b88a2d]">
            QuickFurno Admin
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#101827]">
            Superadmin login
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#667085]">
            Sign in to manage leads, vendors, packages, cities, payments, and marketplace settings.
          </p>
        </div>

        {error && (
          <p className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="text-sm font-medium text-[#344054]">Email</span>
            <input
              autoFocus
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="mt-2 w-full rounded-2xl border border-[#d0d5dd] bg-white px-4 py-3 text-sm text-[#101828] outline-none transition focus:border-[#b88a2d] focus:ring-4 focus:ring-[#b88a2d]/15"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-[#344054]">Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="mt-2 w-full rounded-2xl border border-[#d0d5dd] bg-white px-4 py-3 text-sm text-[#101828] outline-none transition focus:border-[#b88a2d] focus:ring-4 focus:ring-[#b88a2d]/15"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-[#101827] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
