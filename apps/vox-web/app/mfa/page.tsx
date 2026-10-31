import {safeReturnPath} from "../../lib/returnTo.mjs";
import {MfaForm} from "./form";
export const dynamic="force-dynamic";
export default async function Mfa({searchParams}:{searchParams:Promise<{next?:string|string[]}>}){const next=safeReturnPath((await searchParams).next);return <main className="hold"><section className="holdCard"><p className="kicker">VOX / SECOND FACTOR</p><h1>Verify your authenticator</h1><p>Enter the six-digit code from your enrolled staff authenticator. VOX does not accept password-only sessions.</p><MfaForm next={next}/><p><a href="/mfa/enroll">First time? Enroll your authenticator</a></p></section></main>;}
