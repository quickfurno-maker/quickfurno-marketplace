import Link from "next/link";
import {safeReturnPath,withReturn} from "../../lib/returnTo.mjs";
import {MfaForm} from "./form";
import "../login/login.css";
import "./mfa.css";

export const dynamic="force-dynamic";

export default async function Mfa({searchParams}:{searchParams:Promise<{next?:string|string[]}>}){
 const next=safeReturnPath((await searchParams).next);
 return <main className="voxAuthPage voxMfaPage">
  <div className="voxAuthBackdrop" aria-hidden="true"/>
  <div className="voxAuthLayout">
   <aside className="voxAuthStory" aria-label="QuickFurno security">
    <div className="voxAuthBrand">
     <div className="voxAuthMark" aria-hidden="true">V</div>
     <div><strong>VOX</strong><span>QUICKFURNO OPERATIONS</span></div>
    </div>
    <div className="voxAuthPitch">
     <p className="voxAuthEyebrow"><span className="voxAuthPulse"/> SECURE WORKSPACE</p>
     <h2>Work securely.<br/><em>Stay in control.</em></h2>
     <p>Your VOX account uses a second verification step to protect staff information, customer relationships and governed approvals.</p>
     <div className="voxMfaProgress" aria-label="Sign-in step 2 of 2">
      <div className="voxMfaProgressItem"><span className="voxMfaProgressMarker" aria-hidden="true">&#x2713;</span><div><strong>Account credentials</strong><small>First step completed</small></div></div>
      <div className="voxMfaProgressConnector" aria-hidden="true"/>
      <div className="voxMfaProgressItem"><span className="voxMfaProgressMarker voxMfaProgressCurrent" aria-hidden="true">2</span><div><strong>Authenticator verification</strong><small>Confirm it is you</small></div></div>
     </div>
    </div>
    <div className="voxAuthStoryFoot"><span className="voxAuthStoryLock" aria-hidden="true">*</span> Authorized QuickFurno team access only</div>
   </aside>
   <section className="voxAuthCard voxMfaCard" aria-labelledby="vox-mfa-heading">
    <div className="voxAuthCardHead">
     <div className="voxAuthSecurity"><span className="voxAuthSecurityDot" aria-hidden="true"/> IDENTITY CHECK</div>
     <span className="voxAuthCardVersion">STEP 02 / 02</span>
    </div>
    <div className="voxMfaEmblem" aria-hidden="true">
     <svg viewBox="0 0 24 24" width="29" height="29" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2.7 20 6v5.2c0 5.2-3.2 8.6-8 10.2C7.2 19.8 4 16.4 4 11.2V6l8-3.3Z"/>
      <path d="m8.8 11.9 2.2 2.2 4.5-4.7"/>
     </svg>
    </div>
    <div className="voxAuthCardIntro">
     <h1 id="vox-mfa-heading">Verify it's you.</h1>
     <p>Open your authenticator app and enter the six-digit code for your QuickFurno VOX account.</p>
    </div>
    <MfaForm next={next}/>
    <div className="voxMfaEnroll">
     <span>Setting up your authenticator for the first time?</span>
     <Link href={withReturn("/mfa/enroll",next)}>Enroll your authenticator</Link>
    </div>
    <div className="voxAuthCardFoot"><span className="voxAuthFootIcon" aria-hidden="true">*</span> Password-only sessions never unlock VOX</div>
   </section>
  </div>
  <footer className="voxAuthFooter"><span>&copy; QuickFurno &middot; Internal operations</span><span>Encrypted &middot; Authorized personnel only</span></footer>
 </main>;
}
