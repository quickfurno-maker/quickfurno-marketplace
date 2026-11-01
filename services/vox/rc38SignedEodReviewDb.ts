import "server-only";

// QuickFurno runtime is restricted to the Supabase Data API. RC8's receipt
// reconciler currently needs a single pinned, read-only PostgreSQL transaction.
// Neither a direct connection pool nor a synthetic Supabase REST adapter is an
// approved production reader. Do not silently claim a reader is installed.
//
// A reviewed Data API + atomic snapshot/RPC contract and an authorized role
// must be installed before this source can provide a reader. Until then the
// route responds SIGNED_EOD_REVIEW_DB_SOURCE_UNAVAILABLE (503), even if a
// connection URL is supplied. Never fall back to a privileged client.
type Db = {
 query:(sql:string,values?:unknown[])=>Promise<{rows:unknown[];rowCount:number}>;
 release:(destroy?:boolean)=>void;
};
export const RC38_SIGNED_EOD_REVIEW_READER_INSTALLED=false;
export function rc38SignedEodReviewDbSource():(()=>Promise<Db>)|null {
 return null;
}
