import {allowedOrigin,safeJson,staffAuth} from "../../../../lib/auth";
export const runtime="nodejs";
export async function POST(request:Request){
 if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return safeJson({ok:false,error:"STAFF_GATE_DISABLED"},503);
 if(!allowedOrigin(request))return safeJson({ok:false,error:"ORIGIN_DENIED"},403);
 try{const auth=await staffAuth();await auth.auth.signOut();return safeJson({ok:true});}
 catch{return safeJson({ok:false,error:"SIGN_OUT_UNAVAILABLE"},503);}
}
