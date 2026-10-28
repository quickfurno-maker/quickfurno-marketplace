"use client";

import {useState} from "react";

export function RecoveryRequestForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [notice, setNotice] = useState("");
  const [failed, setFailed] = useState(false);

  return (
    <>
      <form className="voxAuthForm" onSubmit={async event => {
        event.preventDefault();
        if (busy || sent) return;
        setBusy(true); setNotice(""); setFailed(false);
        const data = new FormData(event.currentTarget);
        try {
          const response = await fetch("/api/auth/recovery/request", {
            method: "POST",
            headers: {"content-type": "application/json"},
            body: JSON.stringify({email: data.get("email")})
          });
          if (response.ok) {
            setSent(true);
            setNotice("If this account is eligible, a recovery link will arrive shortly. Check your inbox and spam folder.");
          } else {
            setFailed(true);
            setNotice("Recovery could not be requested right now. Please try again later or contact your administrator.");
          }
        } catch {
          setFailed(true);
          setNotice("Recovery is temporarily unavailable. Please try again later.");
        } finally {
          setBusy(false);
        }
      }}>
        <div className="voxAuthField">
          <label htmlFor="vox-recover-email">Work email</label>
          <input id="vox-recover-email" name="email" type="email"
            placeholder="name@company.com" autoComplete="email"
            autoCapitalize="none" spellCheck={false} maxLength={254}
            disabled={busy || sent} required />
        </div>
        <button className="voxAuthSubmit" type="submit" disabled={busy || sent}>
          <span>{busy ? "Requesting securely…" : sent ? "Recovery requested" : "Send recovery link"}</span>
          <span className="voxAuthArrow" aria-hidden="true">→</span>
        </button>
        {notice ? (
          <div className="voxAuthFlowMessage" data-error={failed} role={failed ? "alert" : "status"}>
            <strong>{failed ? "Unable to send request" : "Check your email"}</strong>
            {notice}
          </div>
        ) : null}
      </form>
      <div className="voxAuthFlowNote">
        <span className="voxAuthFlowNoteMark" aria-hidden="true">i</span>
        <span>For security, open the recovery link in this same browser. The link is time-limited and your account is still protected by multi-factor authentication.</span>
      </div>
    </>
  );
}
