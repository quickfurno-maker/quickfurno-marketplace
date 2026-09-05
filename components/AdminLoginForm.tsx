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
      const raw = signInError?.message ?? "";
      let friendly = "Could not sign in. Please try again.";
      if (/invalid login credentials/i.test(raw)) {
        friendly = "Incorrect email or password.";
      } else if (/email not confirmed/i.test(raw)) {
        friendly = "This email is not confirmed yet. Confirm it in Supabase, then sign in.";
      } else if (/rate limit|too many/i.test(raw)) {
        friendly = "Too many attempts. Please wait a moment and try again.";
      } else if (raw) {
        friendly = raw;
      }
      setError(friendly);
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

  /*
    QF-UI-V2-13 — presentation only. Everything above (signInWithPassword, the
    sanitized error mapping, the profiles.role + app_metadata.admin_role
    Superadmin check, the fail-closed signOut, and the refresh/replace redirect)
    is untouched.

    This screen was the one admin surface still on the pre-V2 marketing palette:
    a cream #F3EADF page, a copper #B8874A eyebrow AND focus ring, and a
    near-black #1F1A14 button — none of it using the --qfa-* tokens that the
    whole rest of the admin is built on. It now uses that system: the --qfa-page
    ground, a --qfa-surface card, the shared .qfa-control inputs and .qfa-focus
    ring, and the emerald-600 primary that AdminPrimitives' Button already
    defines as the admin's primary action. Emerald, not the public blue, because
    the admin keeps ONE design language and blue appears nowhere in it.
  */
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--qfa-page)] px-5 py-10 text-[var(--qfa-ink)]">
      <section className="w-full max-w-[420px] rounded-[var(--qfa-radius-lg)] border border-[var(--qfa-line)] bg-[var(--qfa-surface)] p-6 shadow-[var(--qfa-shadow-2)] sm:p-7">
        <div className="mb-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--qfa-muted)]">
            QuickFurno Superadmin
          </p>
          <h1 className="mt-2 text-[26px] font-semibold leading-tight tracking-tight text-[var(--qfa-ink)]">
            Sign in to the command center
          </h1>
          <p className="mt-2 text-[13px] leading-6 text-[var(--qfa-muted)]">
            Manage leads, vendors, packages, cities, payments and marketplace settings.
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="mb-4 rounded-[var(--qfa-radius)] border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] leading-5 text-red-700"
          >
            {error}
          </p>
        )}

        <form className="space-y-3.5" onSubmit={onSubmit}>
          <label className="block">
            <span className="text-[13px] font-medium text-[var(--qfa-ink-soft)]">Email</span>
            <input
              autoFocus
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              className="qfa-control mt-1.5 w-full px-3.5 outline-none"
            />
          </label>

          <label className="block">
            <span className="text-[13px] font-medium text-[var(--qfa-ink-soft)]">Password</span>
            <input
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              className="qfa-control mt-1.5 w-full px-3.5 outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={busy}
            className="qfa-focus mt-1 inline-flex h-[var(--qfa-control-h)] w-full items-center justify-center rounded-[var(--qfa-radius)] bg-emerald-600 px-5 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </section>
    </main>
  );
}
