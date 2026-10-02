"use client";

import { useState } from "react";
import type { VendorContactVerificationSummary } from "@/services/vendorVerificationSummaryService";
import { VendorIcon } from "../icons";

type Stage = "idle" | "requesting" | "code" | "verifying" | "done" | "error";

export function VendorWhatsAppVerificationCard({
  initial,
}: {
  initial: VendorContactVerificationSummary;
}) {
  const [phone, setPhone] = useState(initial.phoneE164 ?? "+");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<Stage>(initial.phoneVerified ? "done" : "idle");
  const [message, setMessage] = useState<string | null>(null);

  async function requestCode() {
    setStage("requesting");
    setMessage(null);
    const response = await fetch("/api/vendor/auth/whatsapp/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const body = await response.json().catch(() => ({})) as {
      ok?: boolean;
      challengeId?: string;
      phoneMasked?: string;
    };
    if (!response.ok || !body.ok || !body.challengeId) {
      setStage("error");
      setMessage("WhatsApp verification could not start. Please contact QuickFurno support.");
      return;
    }
    setChallengeId(body.challengeId);
    setStage("code");
    setMessage(body.phoneMasked ? `Code sent to ${body.phoneMasked}.` : "Verification code sent.");
  }

  async function verifyCode() {
    if (!challengeId) return;
    setStage("verifying");
    setMessage(null);
    const response = await fetch("/api/vendor/auth/whatsapp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challengeId, phone, otp }),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean };
    if (!response.ok || !body.ok) {
      setStage("error");
      setMessage("The code could not be verified. Request a new code or contact support.");
      return;
    }
    setStage("done");
    setOtp("");
    setMessage("WhatsApp number verified.");
  }

  const verified = stage === "done";
  return (
    <section className="qf-vendor-v2-panel qf-vendor-v2-profile-verification">
      <div className="qf-vendor-v2-profile-verification-head">
        <div>
          <h2 className="qf-vendor-v2-panel-title">WhatsApp verification</h2>
          <p className="qf-vendor-v2-profile-section-hint">
            Verify the number QuickFurno should use for secure vendor communication.
          </p>
        </div>
        <span className="qf-vendor-v2-profile-verification-state" data-verified={verified ? "true" : "false"}>
          <VendorIcon name={verified ? "check" : "clock"} size={14} />
          {verified ? "Verified" : "Not verified"}
        </span>
      </div>

      {verified ? (
        <p className="qf-vendor-v2-profile-hint">
          {initial.whatsappVerifiedAt
            ? `Verified on ${new Date(initial.whatsappVerifiedAt).toLocaleDateString("en-IN")}.`
            : "This number is verified."}
        </p>
      ) : !initial.verificationAvailable ? (
        <div className="qf-vendor-v2-profile-alert" data-tone="error" role="status">
          <span className="qf-vendor-v2-profile-alert-icon"><VendorIcon name="alert" size={18} /></span>
          <p className="qf-vendor-v2-profile-alert-text">
            Verification is prepared but the production WhatsApp authentication channel is not active yet.
            Your account remains accessible; QuickFurno support can complete onboarding when the channel is activated.
          </p>
        </div>
      ) : (
        <div className="qf-vendor-v2-profile-verification-form">
          <label className="qf-vendor-v2-profile-field">
            <span className="qf-vendor-v2-profile-label">WhatsApp number</span>
            <input
              className="qf-vendor-v2-profile-input"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+919876543210"
              disabled={stage === "requesting" || stage === "verifying"}
            />
          </label>

          {stage === "code" || stage === "error" || stage === "verifying" ? (
            <label className="qf-vendor-v2-profile-field">
              <span className="qf-vendor-v2-profile-label">6-digit code</span>
              <input
                className="qf-vendor-v2-profile-input"
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                disabled={stage === "verifying"}
              />
            </label>
          ) : null}

          <div className="qf-vendor-v2-profile-verification-actions">
            {challengeId ? (
              <button
                type="button"
                className="qf-vendor-v2-btn qf-vendor-v2-btn--primary"
                onClick={() => void verifyCode()}
                disabled={stage === "verifying" || otp.length !== 6}
              >
                {stage === "verifying" ? "Verifying…" : "Verify code"}
              </button>
            ) : (
              <button
                type="button"
                className="qf-vendor-v2-btn qf-vendor-v2-btn--primary"
                onClick={() => void requestCode()}
                disabled={stage === "requesting" || phone.trim().length < 8}
              >
                {stage === "requesting" ? "Sending…" : "Send verification code"}
              </button>
            )}
            {challengeId && stage !== "verifying" ? (
              <button
                type="button"
                className="qf-vendor-v2-btn qf-vendor-v2-btn--quiet"
                onClick={() => { setChallengeId(null); setOtp(""); setStage("idle"); setMessage(null); }}
              >
                Start again
              </button>
            ) : null}
          </div>
          {message ? <p className="qf-vendor-v2-profile-hint" role="status">{message}</p> : null}
        </div>
      )}
    </section>
  );
}
