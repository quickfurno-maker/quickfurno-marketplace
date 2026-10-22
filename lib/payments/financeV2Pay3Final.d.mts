export type FinanceExpected={providerMode:"test"|"live";merchantAccountId:string;
 providerOrderId:string;providerPaymentId:string;amountSubunits:number;currency:"INR"};
export type FinanceProviderEvent={event_type:string;provider_mode:string;
 merchant_account_id:string};
export function reconcileRazorpayProviderPayment(input:{expected:FinanceExpected;
 provider:any;mode:"test"|"live";merchantAccountId:string}):Readonly<Record<string,unknown>>;
export function deriveFinanceWorkerOutcome(event:FinanceProviderEvent,payment:any,
 expected:FinanceExpected):Readonly<{outcome:"VERIFIED"|"RETRY"|"DEAD_LETTER";reason:string;creditGrant:false}>;
export function processFinanceInboxBatch(input:{
 claim:(max:number)=>Promise<Array<{job_id:string;event_id:string;token:string}>>;
 load:(id:string)=>Promise<{event:FinanceProviderEvent;expected:FinanceExpected}>;
 providerRead:(id:string,mode:"test"|"live")=>Promise<any>;
 finish:(job:string,token:string,outcome:string,reason:string)=>Promise<boolean>;
 max?:number;
}):Promise<ReadonlyArray<Readonly<{jobId:string;accepted:boolean;outcome:string;creditGrant:false}>>>;
