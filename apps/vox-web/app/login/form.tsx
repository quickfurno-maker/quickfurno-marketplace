"use client";
import {useState} from "react";
import {withReturn} from "../../lib/returnTo.mjs";

export function LoginForm({disabled = false, next = null}: {disabled?: boolean; next?: string | null}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="voxAuthForm"
      onSubmit={async event => {
        event.preventDefault();
        if (disabled || busy) return;
        setError("");
        setBusy(true);
        const form = new FormData(event.currentTarget);
        try {
          const r = await fetch("/api/auth/sign-in", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email: form.get("email"), password: form.get("password")})
          });
          if (r.ok) window.location.assign(withReturn("/mfa", next));
          else setError("Sign-in could not be verified.");
        } catch {
          setError("Sign-in unavailable.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="voxAuthField">
        <label htmlFor="vox-auth-email">Work email</label>
        <input id="vox-auth-email" name="email" type="email" placeholder="name@company.com"
          autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254}
          disabled={disabled || busy} />
      </div>
      <div className="voxAuthField">
        <label htmlFor="vox-auth-password">Password</label>
        <input id="vox-auth-password" name="password" type="password" placeholder="Enter your password"
          autoComplete="current-password" required disabled={disabled || busy} />
      </div>
      {error ? <p className="voxAuthError" role="alert">{error}</p> : null}
      <button className="voxAuthSubmit" disabled={disabled || busy} type="submit">
        <span>{disabled ? "Sign-in unavailable in preview" : busy ? "Checking…" : "Continue securely"}</span>
        <span className="voxAuthArrow" aria-hidden="true">→</span>
      </button>
    </form>
  );
}
