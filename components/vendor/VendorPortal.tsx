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
//
// QF-UI-V2-11: the segmented control was an inline-styled copper pill. It is now
// a V2 blue segmented control defined in app/vendor-auth-v2.css. switchMode, the
// router.replace target and the tablist/tab/aria-selected semantics are
// unchanged, so deep links still work exactly as before.
export function VendorPortal({ initialMode = "login" }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    router.replace(`/vendor?mode=${next}`, { scroll: false });
  }

  return (
    <section className="qf-vendor-intro">
      {/*
        QF-UI-V2-12R: the page-level "Vendor Portal" eyebrow was removed. The
        persistent badge in VendorPortalHeader is the contextual indicator, and
        showing both put the same label twice in the first viewport.
      */}
      <h1 className="qf-vendor-intro-title">
        {mode === "login" ? "Login to your vendor dashboard" : "Create vendor account / Apply as vendor"}
      </h1>
      <p className="qf-vendor-intro-sub">
        {mode === "login"
          ? "View assigned leads, credits, profile status, and package details."
          : "Submit your business details. QuickFurno will verify your profile before activating lead access."}
      </p>

      <div className="qf-vauth-tabs" role="tablist" aria-label="Vendor portal">
        <PortalTab active={mode === "login"} onClick={() => switchMode("login")}>
          Vendor Login
        </PortalTab>
        <PortalTab active={mode === "signup"} onClick={() => switchMode("signup")}>
          New Vendor Signup
        </PortalTab>
      </div>

      <div className="qf-vauth-panel">
        {mode === "login" ? (
          <LoginForm signupHref="/vendor?mode=signup" signupLabel="Create a vendor account" />
        ) : (
          <div className="qf-vendor-form-wrap">
            <VendorRegisterForm />
          </div>
        )}
      </div>
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
      className="qf-vauth-tab"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
