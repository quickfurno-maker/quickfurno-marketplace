import {RecoveryRequestForm} from "./form";
import {recoveryEnabled} from "../../../lib/recoveryStage";
import {AuthFlowShell} from "../AuthFlowShell";

export const dynamic = "force-dynamic";

export default function Recover() {
  const enabled = recoveryEnabled();
  return (
    <AuthFlowShell
      title={enabled ? "Recover account access" : "Recovery unavailable"}
      subtitle={enabled
        ? "Enter your enrolled work email. If eligible, you'll receive a secure, time-limited recovery link."
        : "Account recovery is temporarily unavailable. Please contact your authorized VOX administrator."}
      step="ACCOUNT RECOVERY"
    >
      {enabled ? <RecoveryRequestForm /> : null}
      <p className="voxAuthReturn"><a href="/login">← Back to sign in</a></p>
    </AuthFlowShell>
  );
}
