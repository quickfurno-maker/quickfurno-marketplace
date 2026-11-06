"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MOBILE = /^[6-9][0-9]{9}$/;
const TOKEN = /^[0-9]{6,8}$/;
type View = "mobile" | "otp";

/**
 * Returning vendor OTP UI. Supabase Auth + signed delivery remain SERVER-only.
 * No browser flags may activate an unavailable provider.
 */
export function VendorWhatsappLoginForm() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [token, setToken] = useState("");
  const [view, setView] = useState<View>("mobile");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function requestCode() {
    if (!MOBILE.test(mobile)) {
      setError("Enter a valid 10-digit Indian WhatsApp mobile number.");
      return;
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/vendor/auth/login/request-otp", {
        method: "POST", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      const json: unknown = await response.json().catch(() => null);
      const obj = json && typeof json === "object" && !Array.isArray(json)
        ? json as Record<string, unknown> : {};
      if (response.status !== 202 || obj.ok !== true ||
        obj.code !== "OTP_REQUEST_ACCEPTED" ||
        obj.deliveryConfirmed !== false) {
        setError(response.status === 503
          ? "Secure WhatsApp vendor login is not yet available. Please contact QuickFurno."
          : "Could not start verification. Please try again later.");
        return;
      }
      setToken(""); setView("otp");
      setNotice("If this number is eligible, a verification code was requested. " +
        "This does not confirm WhatsApp delivery.");
    } catch {
      setError("WhatsApp verification is currently unavailable.");
    } finally { setBusy(false); }
  }

  async function verifyCode() {
    if (!MOBILE.test(mobile) || !TOKEN.test(token)) {
      setError("Enter the 6–8 digit code from WhatsApp.");
      return;
    }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/vendor/auth/login/verify-otp", {
        method: "POST", cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobile, token }),
      });
      const json: unknown = await response.json().catch(() => null);
      const obj = json && typeof json === "object" && !Array.isArray(json)
        ? json as Record<string, unknown> : {};
      if (response.status !== 200 || obj.ok !== true ||
        obj.code !== "VENDOR_LOGIN_VERIFIED" ||
        obj.redirectTo !== "/vendor/dashboard") {
        setError(response.status === 503
          ? "WhatsApp login is not yet certified."
          : "Verification failed or vendor access is unavailable. Check your code or contact QuickFurno.");
        setToken("");
        return;
      }
      setToken(""); setNotice("Vendor identity verified. Opening your dashboard.");
      router.refresh();
      router.push("/vendor/dashboard");
    } catch {
      setError("Unable to verify your code. Please try again.");
      setToken("");
    } finally { setBusy(false); }
  }

  return (
    <div className="qf-vauth-card" aria-label="Vendor WhatsApp sign in">
      <h2 className="qf-vauth-card-title">Sign in with WhatsApp</h2>
      <p className="qf-vauth-card-sub">
        Use the mobile number verified during registration. Pending applications
        can view their account status; lead matching requires separate approval.
      </p>

      {error ? <p className="qf-vauth-alert" role="alert">{error}</p> : null}
      {notice ? <p className="qf-vauth-note" role="status">{notice}</p> : null}
      <div className="qf-vauth-fields">
        <label className="qf-vauth-field">
          <span>Registered WhatsApp mobile number</span>
          <input
            type="tel" inputMode="numeric" autoComplete="tel-national"
            value={mobile} maxLength={10} disabled={busy}
            onChange={event => {
              setMobile(event.target.value.replace(/[^0-9]/g, "").slice(0,10));
              setView("mobile"); setToken(""); setNotice(""); setError("");
            }} placeholder="10-digit mobile number"
          />
        </label>
        {view === "otp" ? (
          <label className="qf-vauth-field">
            <span>WhatsApp verification code</span>
            <input type="text" inputMode="numeric" autoComplete="one-time-code"
              value={token} maxLength={8} disabled={busy}
              onChange={event => {
                setToken(event.target.value.replace(/[^0-9]/g, "").slice(0,8));
                setError("");
              }} placeholder="6–8 digit code"/>
          </label>
        ) : null}
      </div>
      {view === "mobile" ? (
        <button type="button" className="qf-vauth-btn" disabled={busy || !MOBILE.test(mobile)}
          onClick={() => void requestCode()}>
          {busy ? "Requesting…" : "Request WhatsApp code"}
        </button>
      ) : (
        <>
          <button type="button" className="qf-vauth-btn" disabled={busy || !TOKEN.test(token)}
            onClick={() => void verifyCode()}>
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <button type="button" className="qf-rf-btn qf-rf-btn--ghost"
            disabled={busy} onClick={() => void requestCode()}>
            Request another code
          </button>
        </>
      )}
      <p className="qf-vauth-note">
        No email/password is required for WhatsApp-enrolled vendors. Authentication
        does not approve a business, activate lead matching or add credits.
      </p>
    </div>
  );
}
