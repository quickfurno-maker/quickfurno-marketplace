import {LoginForm} from "./form";
export const dynamic="force-dynamic";
export default function Login(){return <main className="hold"><section className="holdCard"><p className="kicker">VOX / STAFF ONLY</p><h1>Secure staff sign-in</h1><p>Only verified QuickFurno staff with an enrolled authenticator may access operations.</p><LoginForm/>{process.env.VOX_PASSWORD_RECOVERY_ENABLED==="staging"?<p><a href="/password/recover">Recover access to your account</a></p>:null}</section></main>;}
