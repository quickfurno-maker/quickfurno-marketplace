import Link from "next/link";
import {withReturn} from "../../lib/returnTo.mjs";
/** A 401 means no verified AAL2 session: offer the one route that can fix it,
 * and carry the page's own path so MFA lands back here instead of the default
 * screen. A 403 is an authorization decision, not a missing session, so it never
 * offers sign-in (that would be a login loop). Rendering is status-only, so no
 * Core data is needed or revealed.
 */
export function StaffSignInLink({status,returnTo}:{status:number;returnTo?:string}){
 return status===401?<p><Link href={withReturn("/login",returnTo)}>Staff sign-in</Link></p>:null;
}
