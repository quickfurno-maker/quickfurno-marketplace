import {rc68PostRecommendationOwnerAuthority} from "./rc68PostRecommendationOwnerAuthority";
/** A successful comment metadata write needs a fresh Owner identity check.
 * Never claim rollback if the write committed but the Owner session expired.
 * This only edits a bad-lead review comment; it cannot credit an account.
 */
export async function rc73PostCommentOwnerAuthority<T extends {ok:boolean}>(
 receipt:T, verify:()=>Promise<boolean>, timeoutMs=1250
):Promise<T|{ok:false;code:"COMMENT_OUTCOME_UNKNOWN";error:string}>{
 const result=await rc68PostRecommendationOwnerAuthority(receipt,verify,timeoutMs);
 // RC68 returns the ORIGINAL receipt by identity on a verified post-check
 // or failed writer. Any distinct return is the bounded unknown outcome.
 if(result===receipt)return receipt;
 return {ok:false,code:"COMMENT_OUTCOME_UNKNOWN",
  error:"Owner identity could not be reverified after the comment write. Reconcile the original bad-lead report before any retry."};
}
