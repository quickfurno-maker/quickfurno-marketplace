"use client";
// ============================================================================
// QuickFurno — /vendor/set-password
//
// QF-MVP-80.02 GATE-06 REPAIR — the missing landing route.
//
// The Gate-06 activation hands a superadmin a single-use Supabase recovery
// link. Before this page existed, that link had nowhere to land: an audit of
// the deployed tree at 19ecabd found ZERO routes consuming a recovery session
// (no `updateUser`, no `exchangeCodeForSession`, no PASSWORD_RECOVERY handler).
// The vendor would have been redirected to a page that ignored the session, and
// could never have set a password.
//
// The existing /api/vendor/auth/password-reset/* flow does NOT serve this case:
// it is the Phase 5E WhatsApp-OTP reset, which requires an already-VERIFIED
// WhatsApp phone and outbound messaging — neither of which a vendor being given
// their first login has.
//
// FLOW
//   GoTrue redeems the token at <project>/auth/v1/verify and redirects here with
//   the session in the URL FRAGMENT (implicit flow — an admin-generated link has
//   no PKCE verifier in this browser). We adopt that session, strip the fragment
//   from the address bar, let the vendor choose a password, then sign out so the
//   recovery session cannot be reused as a logged-in session.
//
// SECRETS
//   The tokens live in memory and in the fragment only. Nothing here logs,
//   stores, or transmits the password or either token anywhere but Supabase.
// ============================================================================
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabaseBrowser";
import { VENDOR_PASSWORD_MIN_LENGTH } from "@/lib/identity/vendorPasswordReset";

type Phase = "checking" | "ready" | "no-session" | "saving" | "done";

export default function VendorSetPasswordPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const supabase = browserClient();

      // GoTrue reports a refused or expired link in the fragment, not the body.
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const linkError = fragment.get("error_description") || fragment.get("error");
      if (linkError) {
        if (!cancelled) {
          setError("This link is no longer valid. Ask QuickFurno for a new one.");
          setPhase("no-session");
        }
        return;
      }

      const accessToken = fragment.get("access_token");
      const refreshToken = fragment.get("refresh_token");
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        // Drop the tokens out of the address bar as soon as they are adopted.
        window.history.replaceState(null, "", window.location.pathname);
        if (sessionError) {
          if (!cancelled) {
            setError("This link is no longer valid. Ask QuickFurno for a new one.");
            setPhase("no-session");
          }
          return;
        }
      }

      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!data?.user) {
        setError("Open the link QuickFurno sent you, then set your password on this page.");
        setPhase("no-session");
        return;
      }
      setPhase("ready");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setError(null);

      if (password.length < VENDOR_PASSWORD_MIN_LENGTH) {
        setError(`Use at least ${VENDOR_PASSWORD_MIN_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("Both passwords must match.");
        return;
      }

      setPhase("saving");
      const supabase = browserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message || "The password could not be set. Try the link again.");
        setPhase("ready");
        return;
      }

      // A recovery session is for setting a password, not for browsing. Sign it
      // out so the vendor starts a normal session on the login page.
      await supabase.auth.signOut();
      setPhase("done");
      setTimeout(() => router.push("/vendor?mode=login"), 1800);
    },
    [confirm, password, router],
  );

  /*
    QF-UI-V2-11 — presentation only. Everything above this return (fragment
    error handling, setSession, the immediate history.replaceState that strips
    the tokens, getUser, VENDOR_PASSWORD_MIN_LENGTH, the confirm match,
    updateUser, the signOut and the login redirect) is untouched.

    The shared <Header /> is deliberately NOT used here: this is a client page
    holding a recovery session, and mounting the public header would pull the
    whole public nav tree into that render. A plain brand lockup keeps the page
    on-brand without changing what runs while a recovery token is live.
  */
  return (
    <main className="qf-vauth-page">
      <Link href="/" className="qf-vauth-brand">
        Quick<span>Furno</span>
      </Link>

      <div className="qf-vauth-card">
        <h1 className="qf-vauth-card-title">Set your QuickFurno password</h1>

        {phase === "checking" ? (
          <p className="qf-vauth-card-sub" role="status">Checking your link…</p>
        ) : null}

        {phase === "no-session" ? (
          <>
            <p className="qf-vauth-alert" role="alert">{error}</p>
            <p className="qf-vauth-alt">
              <Link href="/vendor?mode=login">Go to vendor login</Link>
            </p>
          </>
        ) : null}

        {phase === "done" ? (
          <p className="qf-vauth-ok" role="status">
            Password saved. Taking you to the login page…
          </p>
        ) : null}

        {phase === "ready" || phase === "saving" ? (
          <form onSubmit={submit}>
            <p className="qf-vauth-card-sub">
              Choose a password for your vendor dashboard. Your business details, package and credits are unchanged.
            </p>

            {error ? <p className="qf-vauth-alert" role="alert">{error}</p> : null}

            <div className="qf-vauth-fields">
              <label className="qf-vauth-field">
                <span>New password</span>
                <input
                  type="password"
                  value={password}
                  autoComplete="new-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="qf-vauth-field">
                <span>Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </label>
            </div>

            <button type="submit" disabled={phase === "saving"} className="qf-vauth-btn">
              {phase === "saving" ? "Saving…" : "Save password"}
            </button>
          </form>
        ) : null}
      </div>
    </main>
  );
}
