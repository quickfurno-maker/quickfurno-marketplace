"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { VendorRegisterForm } from "@/components/VendorRegisterForm";

type Mode = "login" | "signup";

// Single vendor portal surface: one tab for existing vendors to log in, one for
// new vendors to create an account + apply. The active tab is driven by the
// ?mode= query param (login default) so /vendor?mode=login and /vendor?mode=signup
// deep-link straight to the right section. Switching tabs keeps the URL in sync
// without a full navigation. No admin login here — admins use /admin/login (a
// vendor-portal sign-in still routes an admin to /admin/dashboard by role).
export function VendorPortal({ initialMode = "login" }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    router.replace(`/vendor?mode=${next}`, { scroll: false });
  }

  return (
    <section className="qf-vendor-intro" style={{ paddingBottom: "1.5rem" }}>
      <span className="qf-vendor-badge">Vendor Portal</span>
      <h1 className="qf-vendor-intro-title">
        {mode === "login" ? "Login to your vendor dashboard" : "Create vendor account / Apply as vendor"}
      </h1>
      <p className="qf-vendor-intro-sub">
        {mode === "login"
          ? "View assigned leads, credits, profile status, and package details."
          : "Submit your business details. QuickFurno will verify your profile before activating lead access."}
      </p>

      <div
        role="tablist"
        aria-label="Vendor portal"
        style={{
          display: "inline-flex",
          gap: "0.4rem",
          margin: "1.4rem auto 0",
          padding: "0.35rem",
          borderRadius: "999px",
          border: "1px solid rgba(0,0,0,0.08)",
          background: "rgba(0,0,0,0.03)",
        }}
      >
        <PortalTab active={mode === "login"} onClick={() => switchMode("login")}>
          Vendor Login
        </PortalTab>
        <PortalTab active={mode === "signup"} onClick={() => switchMode("signup")}>
          New Vendor Signup
        </PortalTab>
      </div>

      {mode === "login" ? (
        <div style={{ marginTop: "1.8rem", textAlign: "left" }}>
          <LoginForm signupHref="/vendor?mode=signup" signupLabel="Create a vendor account" />
        </div>
      ) : (
        <div className="qf-vendor-form-wrap" style={{ marginTop: "1.6rem" }}>
          <VendorRegisterForm />
        </div>
      )}
    </section>
  );
}

function PortalTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        border: "none",
        cursor: "pointer",
        borderRadius: "999px",
        padding: "0.6rem 1.2rem",
        fontSize: "0.92rem",
        fontWeight: 600,
        color: active ? "#fff" : "#4b3f33",
        background: active ? "#c8892b" : "transparent",
        transition: "background 0.15s ease, color 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}
