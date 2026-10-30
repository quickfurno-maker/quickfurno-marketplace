export interface Rc10FinanceDetail {
 readonly order:{
  readonly orderId:string;readonly vendorRef:string;readonly currency:"INR";
  readonly recordedOrderAmount:number|null;readonly creditsIncluded:number|null;
  readonly orderStatus:string;readonly paymentStatus:string;
  readonly activationStatus:string;readonly createdAt:string;
 };
 readonly ledger:null|{
  readonly recordedPaymentId:string;readonly recordedAmount:number;
  readonly recordedStatus:string;readonly recordedAt:string;
 };
 readonly source:string;readonly ledgerStatus:string;
 readonly isAttemptHistoryComplete:false;readonly providerConfirmed:false;
 readonly canCapture:false;readonly canRefund:false;readonly canGrantCredits:false;
}
export function projectRc10FinanceOrderDetail(order:unknown,payment:unknown):Rc10FinanceDetail|null;
