import {RecoveryRequestForm} from "./form";
import {recoveryEnabled} from "../../../lib/recoveryStage";
export const dynamic="force-dynamic";
export default function Recover(){
 if(!recoveryEnabled())return <main className="hold"><section className="holdCard"><h1>Recovery unavailable</h1><p>Contact your authorized VOX administrator.</p></section></main>;
 return <main className="hold"><section className="holdCard"><p className="kicker">VOX / PRIVATE STAFF</p><h1>Account recovery</h1><p>Use your enrolled work email. If the account is eligible, a time-limited recovery message will be sent.</p><RecoveryRequestForm/></section></main>;
}
