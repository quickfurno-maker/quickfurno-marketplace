/**
 * Phase 3B-15: offline advisory gate, not an executable Production permission.
 * Never read or mutate managed systems from this module.
 */
export interface CandidateVendor {
  id:string;
  city:string;
  categories:readonly string[];
  approved:boolean;
  accepting:boolean;
  verifiedIdentity:boolean;
  verifiedOffice:boolean;
  verifiedZone:boolean;
  credits:number;
}
export interface BetaEvidence{
  sourceSha:string; reviewedSha:string|null;
  ownerApproval:boolean;
  backupRestoreVerified:boolean;
  allTestRecordsRemoved:boolean;
  orphanCount:number|null;
  mode:"off"|"preview"|"auto_suggest"|"unknown";
  modeObserved:boolean;
  approvedCanary:boolean;
  realCanaryPassed:boolean;
  creditLedgerVerified:boolean;
  deliveryIdempotencyVerified:boolean;
  consentVerified:boolean;
  customerSupportReady:boolean;
  rollbackVerified:boolean;
  promotedCategories:readonly string[];
  vendors:readonly CandidateVendor[];
}
export interface GateDecision {
  status:"HOLD"|"READY_FOR_OWNER_FINAL_DECISION";
  blockers:readonly string[];
  byCategory:Readonly<Record<string,number>>;
  advisoryOnly:true;
}
const isSha=(s:string|null)=>typeof s==="string"&&/^[a-f0-9]{40}$/i.test(s);
const norm=(s:string)=>s.trim().toLowerCase();
export function evaluatePuneBeta(e:Readonly<BetaEvidence>):GateDecision {
  const blockers:string[]=[];
  if(!isSha(e.sourceSha)||!isSha(e.reviewedSha)||
    e.sourceSha!==e.reviewedSha||!e.ownerApproval)
      blockers.push("EXACT_SHA_OWNER_GO_MISSING");
  if(!e.backupRestoreVerified)blockers.push("BACKUP_RESTORE_UNVERIFIED");
  if(!e.allTestRecordsRemoved||e.orphanCount!==0)blockers.push("TEST_DATA_NOT_CLEARED");
  if(!e.modeObserved||e.mode==="unknown")blockers.push("MODE_NOT_OBSERVED");
  if(e.mode==="off")blockers.push("ASSIGNMENT_OFF");
  if(!e.approvedCanary||!e.realCanaryPassed||!e.creditLedgerVerified||
      !e.deliveryIdempotencyVerified||!e.consentVerified)
      blockers.push("REAL_CANARY_UNCERTIFIED");
  if(!e.customerSupportReady||!e.rollbackVerified)
      blockers.push("SUPPORT_ROLLBACK_UNREADY");
  const categories=e.promotedCategories.map(norm);
  if(!categories.length||categories.some(x=>!x)||new Set(categories).size!==categories.length)
      blockers.push("INVALID_CATEGORY_SCOPE");
  const seen=new Set<string>();
  const vendors=e.vendors.filter(v=>{
    if(!v.id?.trim()||seen.has(v.id))return false;
    seen.add(v.id);
    return norm(v.city)==="pune"&&v.approved&&v.accepting&&
      v.verifiedIdentity&&v.verifiedOffice&&v.verifiedZone&&
      Number.isInteger(v.credits)&&v.credits>0;
  });
  const byCategory:Record<string,number>={};
  for(const category of [...new Set(categories)].filter(Boolean)){
    byCategory[category]=vendors.filter(v=>v.categories.some(x=>norm(x)===category)).length;
    if(byCategory[category]<3)blockers.push("CATEGORY_SUPPLY_BELOW_3:"+category);
  }
  return Object.freeze({
    status:blockers.length?"HOLD":"READY_FOR_OWNER_FINAL_DECISION",
    blockers:Object.freeze(blockers),
    byCategory:Object.freeze(byCategory),
    advisoryOnly:true as const
  });
}
