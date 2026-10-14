import {TotpEnroll} from "./form";
export const dynamic="force-dynamic";
export default function Enroll(){return <main className="hold"><section className="holdCard">
 <p className="kicker">QUICKFURNO VOX / STAFF SECURITY</p><h1>Set up an authenticator</h1>
 <p>Only an email-verified Superadmin or a separately invited VOX staff identity can enroll in the controlled staging phase. Staff access additionally requires an active Core team and object-scope assignment. Only a verified TOTP factor unlocks approved reads.</p>
 <TotpEnroll/>
 </section></main>;}
