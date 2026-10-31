import "server-only";

// The reconciler needs a dedicated READ-ONLY PostgreSQL reader. No such role is
// provisioned or approved yet, so the source is fail-closed: with no dedicated
// URL configured there is NO client and the route returns 503. The service-role
// Supabase client is deliberately never used as a fallback.
type Db={query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;release:(destroy?:boolean)=>void};
let pool:{connect:()=>Promise<Db>}|null=null;
export function rc38SignedEodReviewDbSource():(()=>Promise<Db>)|null{
 const url=process.env.VOX_RC38_SIGNED_EOD_REVIEW_READER_DATABASE_URL;
 if(typeof url!=="string"||!/^postgres(ql)?:\/\//.test(url))return null;
 return async()=>{
  if(!pool){
   const specifier="pg";
   const pg:any=await import(/* webpackIgnore: true */ specifier);
   const Pool=pg.Pool??pg.default?.Pool;
   pool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:3000,
    statement_timeout:5000,idle_in_transaction_session_timeout:5000,
    options:"-c default_transaction_read_only=on"});
  }
  return pool!.connect();
 };
}
