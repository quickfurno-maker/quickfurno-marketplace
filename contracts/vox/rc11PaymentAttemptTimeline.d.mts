export interface Rc11PaymentTimeline {
 readonly schema:"qf.vox.finance.attempt-evidence.v1";
 readonly readOnly:true;readonly isCompleteHistory:false;
 readonly isProviderSettlementVerified:false;
 readonly canReconcile:false;readonly canRefund:false;readonly canActivateCredits:false;
 readonly eventCount:number;
 readonly events:readonly {
  attemptRef:string;sequence:number;environment:"TEST"|"LIVE";
  eventKind:string;origin:string;observedAt:string;recordedAt:string;
 }[];
}
export function projectRc11PaymentAttemptTimeline(rows:unknown,orderId:string):Rc11PaymentTimeline|null;
