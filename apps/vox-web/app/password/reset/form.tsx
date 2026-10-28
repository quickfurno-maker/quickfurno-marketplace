"use client";

import {useState} from "react";

export function PasswordResetForm() {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || done) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const value = form.get("password");
    const confirm = form.get("confirm");
    setMessage("");
    if (typeof value !== "string" || value.length < 12 || value !== confirm) {
      setFailed(true);
      setMessage("Use at least 12 characters and ensure both password fields match.");
      return;
    }
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch("/api/auth/recovery/complete", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({password: value})
      });
      if (response.ok) {
        formElement.reset();
        setDone(true);
        setMessage("Your password has been updated. Return to sign in to continue securely.");
      } else {
        setFailed(true);
        setMessage("This recovery session is invalid or expired. Request a new recovery link.");
      }
    } catch {
      setFailed(true);
      setMessage("Password reset is temporarily unavailable. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="voxAuthForm" onSubmit={submit}>
      <div className="voxAuthField">
        <label htmlFor="vox-new-password">New password</label>
        <input id="vox-new-password" type="password" name="password" required minLength={12}
          autoComplete="new-password" placeholder="At least 12 characters" disabled={busy || done} />
      </div>
      <div className="voxAuthField">
        <label htmlFor="vox-confirm-password">Confirm new password</label>
        <input id="vox-confirm-password" type="password" name="confirm" required minLength={12}
          autoComplete="new-password" placeholder="Re-enter your new password" disabled={busy || done} />
        <p className="voxAuthFlowHint">Choose a unique password you don't use on other accounts.</p>
      </div>
      <button className="voxAuthSubmit" type="submit" disabled={busy || done}>
        <span>{busy ? "Updating securely…" : done ? "Password updated" : "Update password"}</span>
        <span className="voxAuthArrow" aria-hidden="true">→</span>
      </button>
      {message ? (
        <div className="voxAuthFlowMessage" data-error={failed} role={failed ? "alert" : "status"}>
          <strong>{failed ? "Unable to update password" : "Password updated"}</strong>
          {message}
        </div>
      ) : null}
      <div className="voxAuthFlowNote">
        <span className="voxAuthFlowNoteMark" aria-hidden="true">i</span>
        <span>You'll be signed out of your recovery session after resetting your password. Multi-factor verification remains required.</span>
      </div>
    </form>
  );
}
