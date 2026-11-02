export type BadLeadCreditOnlyAction="restore_credit"|"reject";
export type BadLeadCreditOnlyDecision=Readonly<{
 status:string;reason:string;canApply:boolean;leadCredits:number;
 cashRefundAllowed:false;monetaryWalletCreditAllowed:false;automaticReplacementAllowed:false
}>;
export const BAD_LEAD_CREDIT_ONLY_POLICY:Readonly<{
 version:string;action:"restore_credit";credits:1;
 cashRefundAllowed:false;monetaryWalletCreditAllowed:false;automaticReplacementAllowed:false
}>;
export function preflightBadLeadCreditOnly(input?:{
 report?:Record<string,unknown>|null;
 assignment?:Record<string,unknown>|null;
 actorId?:string|null
}):BadLeadCreditOnlyDecision;
export function isAllowedBadLeadRecoveryAction(action:unknown):action is BadLeadCreditOnlyAction;
