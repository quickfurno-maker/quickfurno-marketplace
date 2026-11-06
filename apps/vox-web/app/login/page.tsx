import {LoginForm} from "./form";
import {safeReturnPath} from "../../lib/returnTo.mjs";
import "./login.css";

export const dynamic = "force-dynamic";

export default async function Login({searchParams}: {searchParams: Promise<{next?: string | string[]}>}) {
  const next = safeReturnPath((await searchParams).next);
  const loginEnabled = process.env.VOX_STAFF_PORTAL_ENABLED === "staging";
  const recoveryEnabled = process.env.VOX_PASSWORD_RECOVERY_ENABLED === "staging";

  return (
    <main className="voxAuthPage">
      <div className="voxAuthBackdrop" aria-hidden="true" />
      <div className="voxAuthLayout">
        <aside className="voxAuthStory" aria-label="About VOX">
          <div className="voxAuthBrand">
            <div className="voxAuthMark" aria-hidden="true">V</div>
            <div>
              <strong>VOX</strong>
              <span>QUICKFURNO OPERATIONS</span>
            </div>
          </div>

          <div className="voxAuthPitch">
            <p className="voxAuthEyebrow"><span className="voxAuthPulse" /> ONE CONNECTED WORKSPACE</p>
            <h2>Work together.<br /><em>Move smarter.</em></h2>
            <p>One secure place for your team, service requests, vendor operations and governed decisions.</p>
            <div className="voxAuthCapabilities" aria-label="VOX modules">
              <span>Team workspace</span>
              <span>Vendor 360</span>
              <span>Service desk</span>
              <span>Approvals</span>
            </div>
          </div>

          <div className="voxAuthStoryFoot">
            <span className="voxAuthStoryLock" aria-hidden="true">✦</span>
            Designed for verified QuickFurno staff
          </div>
        </aside>

        <section className="voxAuthCard" aria-labelledby="vox-signin-heading">
          <div className="voxAuthCardHead">
            <div className="voxAuthSecurity"><span aria-hidden="true" className="voxAuthSecurityDot" /> RESTRICTED ACCESS</div>
            <span className="voxAuthCardVersion">STAFF PORTAL</span>
          </div>
          <div className="voxAuthCardIntro">
            <h1 id="vox-signin-heading">Welcome back</h1>
            <p>Sign in with your QuickFurno staff credentials. An enrolled authenticator is required before access.</p>
          </div>

          {!loginEnabled ? (
            <div className="voxAuthPreviewNote" role="status">
              <span className="voxAuthPreviewSymbol" aria-hidden="true">i</span>
              <div><strong>Private UI preview</strong><span>Sign-in and operational access are disabled in this local build.</span></div>
            </div>
          ) : null}

          <LoginForm disabled={!loginEnabled} next={next} />

          {recoveryEnabled ? <p className="voxAuthRecovery"><a href="/password/recover">Recover account access</a></p> : null}

          <div className="voxAuthCardFoot">
            <span className="voxAuthFootIcon" aria-hidden="true">◆</span>
            Protected with multi-factor authentication
          </div>
        </section>
      </div>

      <footer className="voxAuthFooter">
        <span>© QuickFurno · Internal operations</span>
        <span>Authorized personnel only</span>
      </footer>
    </main>
  );
}
