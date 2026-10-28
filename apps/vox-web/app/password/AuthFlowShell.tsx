import type {ReactNode} from "react";
import "../login/login.css";
import "./auth-flow.css";

type Props = {title:string; subtitle:string; step:string; children:ReactNode; mode?:"recovery"|"mfa"};

export function AuthFlowShell({title,subtitle,step,children,mode="recovery"}:Props) {
  const mfa = mode==="mfa";
  return <main className="voxAuthPage voxRecoveryPage">
    <div className="voxAuthBackdrop" aria-hidden="true"/>
    <div className="voxAuthLayout">
      <aside className="voxAuthStory" aria-label="About VOX">
        <div className="voxAuthBrand">
          <div className="voxAuthMark" aria-hidden="true">V</div>
          <div><strong>VOX</strong><span>QUICKFURNO OPERATIONS</span></div>
        </div>
        <div className="voxAuthPitch">
          <p className="voxAuthEyebrow"><span className="voxAuthPulse"/> PRIVATE STAFF WORKSPACE</p>
          <h2>{mfa ? <>Your work.<br/><em>Protected.</em></> : <>Access, with<br/><em>confidence.</em></>}</h2>
          <p>{mfa ? "An extra layer of security for your team and daily operations." : "Restore your account through a secure, time-limited process. Your team workspace stays protected at every step."}</p>
          <div className="voxAuthCapabilities" aria-label="Security safeguards">
            <span>Verified identity</span><span>Secure authentication</span><span>Private workspace</span>
          </div>
        </div>
        <div className="voxAuthStoryFoot"><span className="voxAuthStoryLock" aria-hidden="true">✦</span>
          {mfa ? "Your security stays in your hands" : "A secure way back to your workspace"}
        </div>
      </aside>
      <section className="voxAuthCard" aria-labelledby="vox-flow-heading">
        <div className="voxAuthCardHead">
          <div className="voxAuthSecurity"><span className="voxAuthSecurityDot" aria-hidden="true"/> RESTRICTED ACCESS</div>
          <span className="voxAuthCardVersion">{step}</span>
        </div>
        <div className="voxAuthCardIntro"><h1 id="vox-flow-heading">{title}</h1><p>{subtitle}</p></div>
        {children}
        <div className="voxAuthCardFoot"><span className="voxAuthFootIcon" aria-hidden="true">◆</span>
          Protected by verified sign-in and multi-factor authentication
        </div>
      </section>
    </div>
    <footer className="voxAuthFooter"><span>© QuickFurno · Internal operations</span><span>Authorized personnel only</span></footer>
  </main>;
}
