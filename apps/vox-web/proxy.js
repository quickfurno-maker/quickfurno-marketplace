import {NextResponse} from "next/server";
import {cloudflareAccessSettings,verifyCloudflareAccessToken} from "./lib/cfAccessGuard.mjs";

// Next 16 Proxy is a defense-in-depth boundary; application Core still
// requires a server-verified Supabase session, immutable Owner role and AAL2.
export async function proxy(request){
  const path=new URL(request.url).pathname;
  if(path==="/api/health")return NextResponse.next();
  // Existing locked private UI stays unchanged. Staging portal is fail-closed
  // until the Access origin-verification configuration is complete.
  if(process.env.VOX_STAFF_PORTAL_ENABLED!=="staging")return NextResponse.next();
  if(process.env.VOX_CF_ACCESS_REQUIRED!=="staging")
    return new Response("Origin security not configured",{status:503});
  const settings=cloudflareAccessSettings();
  if(!settings)return new Response("Origin security unavailable",{status:503});
  if(request.headers.get("host")!=="vox.quickfurno.in")
    return new Response("Forbidden",{status:403});
  const token=request.headers.get("cf-access-jwt-assertion");
  if(!await verifyCloudflareAccessToken(token,settings))
    return new Response("Forbidden",{status:403});
  return NextResponse.next();
}

export const config={matcher:["/((?!_next/static|_next/image|favicon.ico).*)"]};
