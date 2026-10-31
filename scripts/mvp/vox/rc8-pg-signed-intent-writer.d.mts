export function reconcileRc8PgSignedIntentOutcome(input:{
 acquireClient:()=>Promise<{query:(sql:string,values?:unknown[])=>Promise<{rows:any[];rowCount:number}>;release:()=>void}>;
 intentId:string;subjectId:string;expectedReceiptSha256:string
}):Promise<{ok:boolean;outcome?:string|null;receiptSha256?:string;publicationAuthorized:boolean}>;
export function rc8SignedEodPublicationAuthorizationState(proof:unknown):{
 publicationAuthorized:boolean;canPublish:boolean;approved:boolean;state:string;
};
