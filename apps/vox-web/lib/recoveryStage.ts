import "server-only";
export function recoveryEnabled():boolean{
 return process.env.VOX_STAFF_PORTAL_ENABLED==="staging"&&
  process.env.VOX_PASSWORD_RECOVERY_ENABLED==="staging";
}
// Do not construct an Auth redirect URL from request.url, Host or forwarded headers.
export function recoveryOrigin():string|null{
 return process.env.VOX_EXPECTED_ORIGIN==="https://vox.quickfurno.in"?
  "https://vox.quickfurno.in":null;
}
export function trustedRecoveryHost(request:Request):boolean{
 return recoveryOrigin()!==null&&request.headers.get("host")==="vox.quickfurno.in";
}
export const INIT_COOKIE="vox-recovery-init";
export const COMPLETE_COOKIE="vox-recovery-complete";
export const cookieOptions={httpOnly:true,secure:true,sameSite:"lax" as const,
 path:"/",maxAge:600};
