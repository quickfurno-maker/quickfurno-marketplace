// Bounded post-sign-in return path. Same-origin staff pages only: no query,
// hash, scheme, host, encoded or traversal forms. Anything else is rejected.
const ALLOWED=/^\/(?:team|operations|vendor360|service-desk|acquisition|finance|approvals|staff-reviews)(?:\/[a-z0-9][a-z0-9-]{0,40}){0,2}$/;
export function safeReturnPath(raw){
 const value=Array.isArray(raw)?raw[0]:raw;
 if(typeof value!=="string"||value.length>96)return null;
 return ALLOWED.test(value)?value:null;
}
export function withReturn(path,next){
 const safe=safeReturnPath(next);
 return safe?path+"?next="+encodeURIComponent(safe):path;
}
