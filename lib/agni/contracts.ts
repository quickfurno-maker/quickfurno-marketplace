import crypto from "node:crypto";
import { z } from "zod";

export const AGNI_PROPOSAL_PROTOCOL="agni.action.proposal.v1" as const;
export const AGNI_CAPABILITY_PROTOCOL="agni.action.capability.v1" as const;
export const AGNI_PROPOSAL_PATH="/api/internal/agni/proposal" as const;
export const AGNI_CAPABILITY_PATH="/api/internal/agni/capability" as const;

const machine=z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/);
const uuid=z.string().uuid();
const instant=z.string().datetime({offset:false});
const hex64=z.string().regex(/^[0-9a-f]{64}$/);
const traceId=z.string().regex(/^[0-9a-f]{32}$/);

export const agniActionSchema=z.discriminatedUnion("type",[
  z.object({type:z.literal("RUN_SYNTHETIC_TEST"),suite:z.enum(["QUICKFURNO","JARVIS","FULL"])}).strict(),
  z.object({type:z.literal("RESTART_SERVICE"),serviceId:machine}).strict(),
  z.object({type:z.literal("SCALE_SERVICE"),serviceId:machine,replicas:z.number().int().min(1).max(64)}).strict(),
  z.object({type:z.literal("ROLLBACK_RELEASE"),serviceId:machine,releaseId:machine}).strict(),
  z.object({
    type:z.literal("TEMPORARY_RATE_LIMIT"),scope:z.enum(["EDGE","SERVICE"]),targetRef:machine,
    requestsPerMinute:z.number().int().min(10).max(1_000_000),durationSeconds:z.number().int().min(60).max(3600),
  }).strict(),
  z.object({
    type:z.literal("PAUSE_AI_AUTOMATION"),agent:z.enum(["ALL","RIYA","ANISHA","AAROHI"]),
    durationSeconds:z.number().int().min(60).max(3600),
  }).strict(),
  z.object({
    type:z.literal("ENTER_RESTRICTED_MODE"),system:z.enum(["QUICKFURNO","JARVIS"]),
    durationSeconds:z.number().int().min(60).max(3600),
  }).strict(),
  z.object({type:z.literal("ROTATE_SERVICE_CREDENTIAL"),credentialRef:machine}).strict(),
]);
export type AgniAction=z.infer<typeof agniActionSchema>;

export const AGNI_ACTION_RISK={
  RUN_SYNTHETIC_TEST:"LOW",
  RESTART_SERVICE:"MEDIUM",
  SCALE_SERVICE:"MEDIUM",
  ROLLBACK_RELEASE:"HIGH",
  TEMPORARY_RATE_LIMIT:"MEDIUM",
  PAUSE_AI_AUTOMATION:"HIGH",
  ENTER_RESTRICTED_MODE:"HIGH",
  ROTATE_SERVICE_CREDENTIAL:"CRITICAL",
} as const;

export const agniProposalSchema=z.object({
  protocolVersion:z.literal(1),
  proposalId:uuid,
  incidentId:uuid,
  targetSystem:z.enum(["QUICKFURNO","JARVIS"]),
  targetService:machine,
  action:agniActionSchema,
  actionFingerprint:hex64,
  risk:z.enum(["LOW","MEDIUM","HIGH","CRITICAL"]),
  requestedApprovalMode:z.enum(["NONE","PREAUTHORIZED_POLICY","HUMAN"]),
  expectedRevision:z.number().int().nonnegative().optional(),
  evidenceRefs:z.array(machine).max(16),
  expectedEffectCode:machine,
  rollbackCode:machine,
  policyEvidenceRef:machine,
  criticEvidenceRef:machine,
  createdAt:instant,
  expiresAt:instant,
}).strict();
export type AgniProposal=z.infer<typeof agniProposalSchema>;

export const agniProposalSubmissionSchema=z.object({
  protocol:z.literal(AGNI_PROPOSAL_PROTOCOL),
  proposal:agniProposalSchema,
}).strict();

export const agniCapabilityRequestSchema=z.object({
  protocol:z.literal(AGNI_CAPABILITY_PROTOCOL),
  proposalId:uuid,
  actionFingerprint:hex64,
  requestedAt:instant,
}).strict();
export type AgniCapabilityRequest=z.infer<typeof agniCapabilityRequestSchema>;

export const agniCapabilitySchema=z.object({
  protocolVersion:z.literal(1),
  capabilityId:uuid,
  proposalId:uuid,
  incidentId:uuid,
  actionFingerprint:hex64,
  targetSystem:z.enum(["QUICKFURNO","JARVIS"]),
  targetService:machine,
  actionType:z.enum([
    "RUN_SYNTHETIC_TEST","RESTART_SERVICE","SCALE_SERVICE","ROLLBACK_RELEASE",
    "TEMPORARY_RATE_LIMIT","PAUSE_AI_AUTOMATION","ENTER_RESTRICTED_MODE","ROTATE_SERVICE_CREDENTIAL",
  ]),
  expectedRevision:z.number().int().nonnegative().optional(),
  environment:z.enum(["staging","production"]),
  approvalMode:z.enum(["PREAUTHORIZED_POLICY","HUMAN"]),
  approvedByRef:machine,
  policyEvidenceRef:machine,
  criticEvidenceRef:machine,
  nonce:machine,
  issuedAt:instant,
  expiresAt:instant,
}).strict();
export type AgniCapability=z.infer<typeof agniCapabilitySchema>;

export const signedAgniCapabilitySchema=z.object({
  capability:agniCapabilitySchema,
  keyId:z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  signature:z.string().min(80).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export type SignedAgniCapability=z.infer<typeof signedAgniCapabilitySchema>;

function canonicalize(value:unknown):string{
  if(value===null)return "null";
  if(typeof value==="string")return JSON.stringify(value);
  if(typeof value==="number"){
    if(!Number.isFinite(value))throw new TypeError("AGNI_NON_FINITE_NUMBER");
    return JSON.stringify(value);
  }
  if(typeof value==="boolean")return value?"true":"false";
  if(Array.isArray(value))return "["+value.map(canonicalize).join(",")+"]";
  if(typeof value==="object"){
    const record=value as Record<string,unknown>;
    return "{"+Object.keys(record).sort().map((key)=>JSON.stringify(key)+":"+canonicalize(record[key])).join(",")+"}";
  }
  throw new TypeError("AGNI_NON_CANONICAL_VALUE");
}

export function fingerprintAgniAction(input:{
  readonly targetSystem:"QUICKFURNO"|"JARVIS";
  readonly targetService:string;
  readonly action:AgniAction;
  readonly expectedRevision?:number;
}):string{
  const action=agniActionSchema.parse(input.action);
  const value={
    targetSystem:input.targetSystem,
    targetService:machine.parse(input.targetService),
    action,
    ...(input.expectedRevision===undefined?{}:{expectedRevision:z.number().int().nonnegative().parse(input.expectedRevision)}),
  };
  return crypto.createHash("sha256").update(canonicalize(value),"utf8").digest("hex");
}

export function parseAgniProposalSubmission(value:unknown):AgniProposal|null{
  const parsed=agniProposalSubmissionSchema.safeParse(value);
  if(!parsed.success)return null;
  const proposal=parsed.data.proposal;
  const created=Date.parse(proposal.createdAt),expires=Date.parse(proposal.expiresAt);
  if(expires<=created||expires-created>30*60_000)return null;
  if(proposal.risk!==AGNI_ACTION_RISK[proposal.action.type])return null;
  if(
    (proposal.action.type==="RESTART_SERVICE"||proposal.action.type==="SCALE_SERVICE"||proposal.action.type==="ROLLBACK_RELEASE")&&
    proposal.action.serviceId!==proposal.targetService
  )return null;
  if(proposal.action.type==="ENTER_RESTRICTED_MODE"&&proposal.action.system!==proposal.targetSystem)return null;
  if((proposal.risk==="HIGH"||proposal.risk==="CRITICAL")&&!proposal.criticEvidenceRef.startsWith("jev."))return null;
  const expected=fingerprintAgniAction({
    targetSystem:proposal.targetSystem,targetService:proposal.targetService,action:proposal.action,
    ...(proposal.expectedRevision===undefined?{}:{expectedRevision:proposal.expectedRevision}),
  });
  return expected===proposal.actionFingerprint?proposal:null;
}

export function parseAgniCapabilityRequest(value:unknown):AgniCapabilityRequest|null{
  const parsed=agniCapabilityRequestSchema.safeParse(value);
  return parsed.success?parsed.data:null;
}

export function canonicalAgniCapability(capability:AgniCapability):string{
  return canonicalize(agniCapabilitySchema.parse(capability));
}

export function signAgniCapability(args:{
  readonly capability:AgniCapability;
  readonly keyId:string;
  readonly privateKeyPem:string;
}):SignedAgniCapability{
  const capability=agniCapabilitySchema.parse(args.capability);
  const issued=Date.parse(capability.issuedAt),expires=Date.parse(capability.expiresAt);
  if(expires<=issued||expires-issued>10*60_000)throw new TypeError("AGNI_CAPABILITY_WINDOW_INVALID");
  if(!/^[A-Za-z0-9._:-]{1,64}$/.test(args.keyId))throw new TypeError("AGNI_CAPABILITY_KEY_INVALID");
  const key=crypto.createPrivateKey(args.privateKeyPem);
  if(key.type!=="private"||key.asymmetricKeyType!=="ed25519")throw new TypeError("AGNI_CAPABILITY_KEY_INVALID");
  const signature=crypto.sign(null,Buffer.from(canonicalAgniCapability(capability),"utf8"),key).toString("base64url");
  return signedAgniCapabilitySchema.parse({capability,keyId:args.keyId,signature});
}

export function agniScaleTraceValid(trace:string):boolean{return traceId.safeParse(trace).success;}
