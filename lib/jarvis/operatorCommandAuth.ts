import crypto from "node:crypto";

import {
  QFJ_OPERATOR_COMMAND_AUDIENCE,
  QFJ_OPERATOR_COMMAND_CALLER,
  QFJ_OPERATOR_COMMAND_FRESHNESS_MS,
  QFJ_OPERATOR_COMMAND_PATH,
  QFJ_OPERATOR_COMMAND_SIGNING_DOMAIN,
  type QfjOperatorCommand,
} from "./operatorCommandContract";
import { rawQfjBodyDigest, type QfjVerificationKey } from "./coreDecisionAuth";

const KEY_ID=/^[A-Za-z0-9._:-]{1,64}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{1,512}$/;

export function qfjOperatorCommandSigningInput(args:{
  readonly commandId:string;
  readonly issuedAt:string;
  readonly keyId:string;
  readonly operatorId:string;
  readonly bodyDigest:string;
}):string{
  return [
    QFJ_OPERATOR_COMMAND_SIGNING_DOMAIN,
    "POST",
    QFJ_OPERATOR_COMMAND_PATH,
    QFJ_OPERATOR_COMMAND_CALLER,
    QFJ_OPERATOR_COMMAND_AUDIENCE,
    args.operatorId,
    args.commandId,
    args.issuedAt,
    args.keyId,
    args.bodyDigest,
  ].join("\n");
}

export function verifyQfjOperatorCommandSignature(args:{
  readonly rawBody:Uint8Array;
  readonly command:QfjOperatorCommand;
  readonly keyId:string|null;
  readonly signature:string|null;
  readonly operatorId:string|null;
  readonly keys:readonly QfjVerificationKey[];
  readonly now:string;
}):boolean{
  if(
    !args.keyId||!KEY_ID.test(args.keyId)||
    !args.signature||!SIGNATURE.test(args.signature)||
    !args.operatorId||!KEY_ID.test(args.operatorId)
  )return false;
  const current=Date.parse(args.now),issued=Date.parse(args.command.issuedAt);
  if(!Number.isFinite(current)||!Number.isFinite(issued)||Math.abs(current-issued)>QFJ_OPERATOR_COMMAND_FRESHNESS_MS)return false;
  const configured=args.keys.find(entry=>entry.keyId===args.keyId);
  if(!configured)return false;
  let signatureBytes:Buffer;
  try{signatureBytes=Buffer.from(args.signature,"base64url");}catch{return false;}
  if(signatureBytes.length!==64)return false;
  try{
    const key=crypto.createPublicKey(configured.publicKeyPem);
    const input=qfjOperatorCommandSigningInput({
      commandId:args.command.commandId,
      issuedAt:args.command.issuedAt,
      keyId:args.keyId,
      operatorId:args.operatorId,
      bodyDigest:rawQfjBodyDigest(args.rawBody),
    });
    return crypto.verify(null,Buffer.from(input,"utf8"),key,signatureBytes);
  }catch{return false;}
}
