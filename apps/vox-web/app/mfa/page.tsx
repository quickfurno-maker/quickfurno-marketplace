import {MfaForm} from "./form";
import {AuthFlowShell} from "../password/AuthFlowShell";
import "./mfa.css";
export const dynamic = "force-dynamic";
export default function Mfa() {
  return <AuthFlowShell mode="mfa" step="SECOND FACTOR" title="Verify it's you"
    subtitle="Enter the six-digit code from your enrolled authenticator app to continue.">
    <MfaForm/>
    <div className="voxAuthFlowNote">
      <span className="voxAuthFlowNoteMark" aria-hidden="true">i</span>
      <span>Only verified authenticator codes work. Never share your code with anyone, including support.</span>
    </div>
    <p className="voxAuthReturn"><a href="/mfa/enroll">First time? Set up your authenticator</a></p>
  </AuthFlowShell>;
}
