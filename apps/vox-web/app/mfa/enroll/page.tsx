import {TotpEnroll} from "./form";
export const dynamic="force-dynamic";
export default function Enroll(){return <main className="hold"><section className="holdCard">
 <p className="kicker">QUICKFURNO VOX / STAFF SECURITY</p><h1>Set up an authenticator</h1>
 <p>For the initial staging phase, enrollment is restricted to an email-verified Core Superadmin who has signed in with a password. Only a verified TOTP factor unlocks read access.</p>
 <TotpEnroll/>
 </section></main>;}
