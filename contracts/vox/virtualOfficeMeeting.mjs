/**
 * VOX V0 provider-neutral meeting intent boundary. No credentials or calls.
 * Google Meet is the proposed V1 adapter; Teams remains independently pluggable.
 * A validated invitation is not authorization to invite staff: Core must prove
 * every participant, team/city grant and meeting purpose before provider I/O.
 */
export const VO_MEETING_SCHEMA="qf.vox.virtual-office.meeting-intent.v1";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=reason=>Object.freeze({ok:false,reason,providerCalled:false});
export function validateMeetingIntent(raw){
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return deny("INVALID_MEETING_INTENT");
 const keys=Object.keys(raw).sort().join("|");
 if(keys!=="nonce|participantIds|taskId|title")return deny("UNKNOWN_OR_MISSING_FIELDS");
 if(typeof raw.nonce!=="string"||!uuid.test(raw.nonce)||
    (raw.taskId!==null&&(typeof raw.taskId!=="string"||!uuid.test(raw.taskId)))||
    typeof raw.title!=="string"||raw.title!==raw.title.trim()||
    raw.title.length<3||raw.title.length>90||
    /[\u0000-\u001f\u007f]/.test(raw.title)||!Array.isArray(raw.participantIds)||
    raw.participantIds.length<1||raw.participantIds.length>30||
    !raw.participantIds.every(x=>typeof x==="string"&&uuid.test(x))||
    new Set(raw.participantIds).size!==raw.participantIds.length)
  return deny("INVALID_MEETING_FIELDS");
 return Object.freeze({ok:true,schema:VO_MEETING_SCHEMA,providerCalled:false,
  intent:Object.freeze({nonce:raw.nonce,title:raw.title,taskId:raw.taskId,
   participantIds:Object.freeze([...raw.participantIds])})});
}
export function googleMeetJoinLink(value){
 if(typeof value!=="string")return deny("INVALID_PROVIDER_LINK");
 try{
  const u=new URL(value);
  if(u.protocol!=="https:"||u.hostname!=="meet.google.com"||
     u.username||u.password||u.port||u.search||u.hash||
     !/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(u.pathname))
   return deny("INVALID_PROVIDER_LINK");
  return Object.freeze({ok:true,provider:"google_meet",joinUrl:u.href,providerCalled:false});
 }catch{return deny("INVALID_PROVIDER_LINK");}
}
