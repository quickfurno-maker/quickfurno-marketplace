export function reconcileRc8PgSignedIntentOutcome(input:{
 acquireClient:()=>Promise<{query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;release:(destroy?:boolean)=>void}>;
 intentId:string;subjectId:string;expectedReceiptSha256:string
}):Promise<{ok:boolean;outcome?:string|null;receiptSha256?:string;publicationAuthorized:boolean;
 intentId?:string;subjectId?:string;ownerId?:string;teamLeaderId?:string;teamId?:string;cityId?:string}>;
export function rc8SignedEodPublicationAuthorizationState(proof:unknown):{
 publicationAuthorized:boolean;canPublish:boolean;approved:boolean;state:string;
};
