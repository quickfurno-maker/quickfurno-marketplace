import {TotpEnroll} from "./form";
import {AuthFlowShell} from "../../password/AuthFlowShell";
import "../mfa.css";
export const dynamic = "force-dynamic";
export default function Enroll() {
  return <AuthFlowShell mode="mfa" step="AUTHENTICATOR SETUP" title="Secure your account"
    subtitle="Set up a trusted authenticator app. Enrollment is available only to approved VOX identities.">
    <TotpEnroll/>
    <p className="voxAuthReturn"><a href="/mfa">← Back to verification</a></p>
  </AuthFlowShell>;
}
