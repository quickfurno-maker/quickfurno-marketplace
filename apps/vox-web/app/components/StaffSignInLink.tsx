import Link from "next/link";
/** A 401 means no verified AAL2 session: offer the one route that can fix it.
 * Rendering is status-only, so no Core data is needed or revealed.
 */
export function StaffSignInLink({status}:{status:number}){
 return status===401?<p><Link href="/login">Staff sign-in</Link></p>:null;
}
