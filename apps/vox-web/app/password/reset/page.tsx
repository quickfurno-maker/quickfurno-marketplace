import {PasswordResetForm} from "./form";
import {recoveryEnabled} from "../../../lib/recoveryStage";
import {AuthFlowShell} from "../AuthFlowShell";

export const dynamic = "force-dynamic";

export default function ResetPassword() {
  const enabled = recoveryEnabled();
  return (
    <AuthFlowShell
      title={enabled ? "Choose a new password" : "Recovery unavailable"}
      subtitle={enabled
        ? "Create a strong password for your VOX account. You'll sign in again after this step."
        : "Password changes are temporarily unavailable. Please contact your authorized VOX administrator."}
      step="PASSWORD RESET"
    >
      {enabled ? <PasswordResetForm /> : null}
      <p className="voxAuthReturn"><a href="/login">← Back to sign in</a></p>
    </AuthFlowShell>
  );
}
