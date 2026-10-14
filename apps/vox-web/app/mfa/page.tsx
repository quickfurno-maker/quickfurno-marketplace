import {MfaForm} from "./form";
export const dynamic="force-dynamic";
export default function Mfa(){return <main className="hold"><section className="holdCard"><p className="kicker">VOX / SECOND FACTOR</p><h1>Verify your authenticator</h1><p>Enter the six-digit code from your enrolled staff authenticator. VOX does not accept password-only sessions.</p><MfaForm/><p><a href="/mfa/enroll">First time? Enroll your authenticator</a></p></section></main>;}
