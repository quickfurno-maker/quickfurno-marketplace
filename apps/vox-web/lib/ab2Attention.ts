/**
 * AB-2 dashboard attention classifier.
 * Uses ONLY sanitized, already-Core-verified read-only work metadata.
 * These are labels, not SLA violations, guaranteed totals or live actions.
 */
import type {UnifiedWorkItem,UnifiedRead} from "./ui04Workspace";
export type AttentionCandidate=Readonly<{
 referenceId:string;
 kind:UnifiedWorkItem["subjectKind"];
 state:string;
 reason:"BLOCKED"|"AWAITING_APPROVAL"|"WAITING_EXTERNAL";
 updatedAt:string;
}>;
export type AttentionWindow=Readonly<{
 knownIncomplete:true; officialSlaBreaches:null;
 candidates:readonly AttentionCandidate[];
 totalBounded:number;
}>;
export function deriveBoundedAttention(view:UnifiedRead):AttentionWindow{
 if(!view.ok)return {knownIncomplete:true,officialSlaBreaches:null,
  candidates:[],totalBounded:0};
 const candidates:AttentionCandidate[]=[];
 for(const item of view.items){
  const reason=item.state==="BLOCKED"?"BLOCKED":
   item.state==="WAITING_APPROVAL"?"AWAITING_APPROVAL":
   item.state==="WAITING_EXTERNAL"?"WAITING_EXTERNAL":null;
  if(reason) candidates.push(Object.freeze({
   referenceId:item.referenceId,kind:item.subjectKind,
   state:item.state,reason,updatedAt:item.updatedAt
  }));
 }
 candidates.sort((a,b)=>(
  (a.reason==="BLOCKED"?0:a.reason==="AWAITING_APPROVAL"?1:2)-
  (b.reason==="BLOCKED"?0:b.reason==="AWAITING_APPROVAL"?1:2)
 )||Date.parse(a.updatedAt)-Date.parse(b.updatedAt)||
 a.referenceId.localeCompare(b.referenceId));
 return Object.freeze({knownIncomplete:true,officialSlaBreaches:null,
  candidates:Object.freeze(candidates.slice(0,25)),
  totalBounded:view.items.length});
}
