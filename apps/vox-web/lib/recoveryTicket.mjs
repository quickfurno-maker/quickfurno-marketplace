import {createHmac,randomBytes,timingSafeEqual,createHash} from "node:crypto";
const LIFETIME_MS=10*60*1000;
const ticketRegex=/^[A-Za-z0-9_-]{20,560}\.[a-f0-9]{64}$/;
function keyBytes(encoded){
 if(!/^[A-Za-z0-9_-]{43}$/.test(encoded))throw new Error("RECOVERY_KEY_UNCONFIGURED");
 const key=Buffer.from(encoded,"base64url");
 if(key.length!==32||key.toString("base64url")!==encoded)throw new Error("RECOVERY_KEY_INVALID");
 return key;
}
export function recoveryKey(){return process.env.VOX_RECOVERY_SIGNING_KEY??"";}
export function emailDigest(email){
 return createHash("sha256").update(email.trim().toLowerCase(),"utf8").digest("hex");
}
export function issueRecoveryTicket(purpose,binding,key,now=Date.now()){
 const secret=keyBytes(key);
 if(purpose!=="init"&&purpose!=="complete")throw new Error("INVALID_PURPOSE");
 if(!/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/i.test(binding))throw new Error("INVALID_BINDING");
 const value={purpose,binding,iat:now,exp:now+LIFETIME_MS,nonce:randomBytes(18).toString("base64url")};
 const payload=Buffer.from(JSON.stringify(value),"utf8").toString("base64url");
 const signature=createHmac("sha256",secret).update(payload).digest("hex");
 return payload+"."+signature;
}
export function verifyRecoveryTicket(ticket,purpose,binding,key,now=Date.now()){
 try{
  if(!ticket||!ticketRegex.test(ticket))return false;
  const secret=keyBytes(key);
  const [payload,signature]=ticket.split(".");
  const expected=createHmac("sha256",secret).update(payload).digest();
  if(!timingSafeEqual(Buffer.from(signature,"hex"),expected))return false;
  const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
  if(!data||typeof data!=="object"||Array.isArray(data))return false;
  const v=data;
  return v.purpose===purpose&&v.binding===binding&&
   typeof v.nonce==="string"&&/^[a-zA-Z0-9_-]{24}$/.test(v.nonce)&&
   typeof v.iat==="number"&&Number.isSafeInteger(v.iat)&&
   typeof v.exp==="number"&&Number.isSafeInteger(v.exp)&&
   v.iat<=now&&v.exp>now&&v.exp-v.iat===LIFETIME_MS;
 }catch{return false;}
}
