"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";

// Role-based sign-in used by the vendor portal (/vendor). The redirect stays
// role-based: admins go to /admin/dashboard even if they sign in here, everyone
// else goes to /vendor/dashboard. The signup link is configurable so the same
// form can point vendors at the portal's signup tab.
//
// QF-UI-V2-11 restyled this card onto the V2 vendor-auth system. The auth path
// below is UNCHANGED: same browserClient(), same signInWithPassword, same
// profiles.role read, same refresh-then-push redirect, same error surface, same
// Enter-to-submit on both fields. Only markup, classes and the accessibility
// wiring (labels, alert role, autocomplete hints) moved.
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
    <div className="qf-vauth-card">
      <h2 className="qf-vauth-card-title">Welcome back</h2>
      <p className="qf-vauth-card-sub">
        Sign in to manage assigned leads, credits and your business profile.
      </p>

      {error ? (
        <p className="qf-vauth-alert" role="alert">
          {error}
        </p>
      ) : null}

      <div className="qf-vauth-fields">
        <label className="qf-vauth-field">
          <span>Email</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            autoComplete="email"
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          />
        </label>
        <label className="qf-vauth-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
          />
        </label>
      </div>

      <button onClick={onSubmit} disabled={busy} className="qf-vauth-btn">
        {busy ? "Signing in…" : "Sign in"}
      </button>

      {showSignupLink ? (
        <p className="qf-vauth-alt">
          New to QuickFurno? <a href={signupHref}>{signupLabel}</a>
        </p>
      ) : null}

      <p className="qf-vauth-note">Vendor access is for registered QuickFurno vendors.</p>
    </div>
  );
}
