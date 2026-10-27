import {PasswordResetForm} from "./form";
import {recoveryEnabled} from "../../../lib/recoveryStage";
export const dynamic="force-dynamic";
export default function ResetPassword(){
 if(!recoveryEnabled())return <main className="hold"><section className="holdCard"><h1>Recovery unavailable</h1></section></main>;
 return <main className="hold"><section className="holdCard"><p className="kicker">VOX / ACCOUNT RECOVERY</p><h1>Choose a new password</h1><p>Use a new strong password. Your one-time recovery session will be signed out after changing it.</p><PasswordResetForm/></section></main>;
}
