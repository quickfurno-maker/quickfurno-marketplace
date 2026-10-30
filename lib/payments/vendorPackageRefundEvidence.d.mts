export interface VendorPackageRefundEvidence {
 localOrderId:string;
 paymentId:string;
 providerMode:"test"|"live";
 paymentCaptured:boolean;
 providerReconciled:boolean;
 ledgerReconciled:boolean;
 vendorAssignmentReconciled:boolean;
 paymentRefunded:boolean;
 refundPending:boolean;
 activationStatus:string;
 creditsGranted:number;
 creditsConsumed:number;
 creditsRemaining:number;
}
export interface VendorPackageRefundReview {
 readonly ok:boolean;
 readonly reason:string;
 readonly refundAllowed:false;
 readonly reversibleCredits:number;
 readonly requiresHumanReview:true;
}
export function assessVendorPackageRefundEvidence(
  evidence:unknown
):VendorPackageRefundReview;
