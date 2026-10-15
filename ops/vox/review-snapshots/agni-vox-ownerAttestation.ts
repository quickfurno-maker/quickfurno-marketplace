import {createHmac,timingSafeEqual} from 'node:crypto';
import {projectVoxAgniOwnerObservation} from './voxOwnerObservation.js';
import type {AgniSystemHealthSnapshot} from './index.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface VoxOwnerAttestedView {
 readonly schema:'qf.vox.agni.owner.attested.v1';
 readonly scope:'OWNER_ONLY';readonly mode:'READ_ONLY';readonly actionsEnabled:false;
 readonly transport:'SIGNED_VERIFIED';readonly ownerId:string;
 readonly systems:ReturnType<typeof projectVoxAgniOwnerObservation>['systems'];
}
export async function verifyVoxAgniOwnerEnvelope(input:{
 token:string;secret:string;ownerUserId:string;
 claimOnce:(jti:string,expires:number)=>Promise<boolean>;
 authorizeCurrentOwner:(ownerId:string)=>Promise<boolean>;
 now?:Date;
}):Promise<VoxOwnerAttestedView>{
 const {token,secret,ownerUserId,claimOnce,authorizeCurrentOwner,now=new Date()}=input;
 if(!UUID.test(ownerUserId)||typeof secret!=='string'||secret.length<32||
  typeof claimOnce!=='function'||typeof authorizeCurrentOwner!=='function'||
  !Number.isFinite(now.getTime())||typeof token!=='string'||token.length>12000)
   throw Error('AGNI_ATTESTATION_CONFIG_DENIED');
 const parts=token.split('.');
 if(parts.length!==2||parts.some(p=>!p||!/^[A-Za-z0-9_-]+$/.test(p)))
  throw Error('AGNI_TOKEN_INVALID');
 const mac=createHmac('sha256',secret).update(parts[0]!).digest();
 const sig=Buffer.from(parts[1]!,'base64url');
 if(sig.length!==mac.length||!timingSafeEqual(mac,sig))
  throw Error('AGNI_SIGNATURE_DENIED');
 let body:unknown;
 try{body=JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8'));}
 catch{throw Error('AGNI_PAYLOAD_INVALID');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('AGNI_PAYLOAD_DENIED');
 const b=body as Record<string,unknown>;
 if(Object.keys(b).sort().join('|')!=='aud|exp|iat|iss|jti|ownerId|schema|snapshots'||
  b['schema']!=='qf.vox.agni.owner.envelope.v1'||b['iss']!=='qf-agni-owner-gateway'||
  b['aud']!=='quickfurno-vox-owner'||b['ownerId']!==ownerUserId||
  !UUID.test(String(b['jti']))||!Number.isSafeInteger(b['iat'])||
  !Number.isSafeInteger(b['exp'])||typeof b['iat']!=='number'||typeof b['exp']!=='number')
  throw Error('AGNI_CLAIMS_DENIED');
 const nowSeconds=Math.floor(now.getTime()/1000),iat=b['iat'] as number,exp=b['exp'] as number;
 if(iat>nowSeconds+30||iat<nowSeconds-120||exp<=nowSeconds||exp>iat+120)
  throw Error('AGNI_EXPIRED');
 if(!Array.isArray(b['snapshots'])||b['snapshots'].length>3)
  throw Error('AGNI_SNAPSHOT_BOUNDS_DENIED');
 // Re-validate an active owner identity before consuming token; no client roles.
 // Validate/derive the entire sanitised observation BEFORE consuming the
 // durable one-use receipt. A malformed duplicate or invalid snapshot must
 // not burn a valid signed proof and force the owner into a false replay.
 const projection=projectVoxAgniOwnerObservation(b['snapshots'] as AgniSystemHealthSnapshot[],now);
 if(await authorizeCurrentOwner(ownerUserId)!==true)throw Error('AGNI_OWNER_SCOPE_DENIED');
 if(await claimOnce(String(b['jti']),exp)!==true)throw Error('AGNI_REPLAY_DENIED');
 return Object.freeze({schema:'qf.vox.agni.owner.attested.v1',ownerId:ownerUserId,
  scope:'OWNER_ONLY',mode:'READ_ONLY',actionsEnabled:false,
  transport:'SIGNED_VERIFIED',systems:projection.systems});
}
