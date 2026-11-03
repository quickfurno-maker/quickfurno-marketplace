export declare function writeScopedTimeCommand(
 command:Record<string,unknown>,
 deps:{
  environment:string;
  enabled:()=>boolean;
  installed:()=>boolean;
  currentScopedStaff:()=>Promise<unknown>;
  currentTaskGrant:(scope:unknown,workItemId:string)=>Promise<boolean>;
  rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
 }
):Promise<{
 ok:boolean;reason?:string;nonce?:string;revision?:number;
 eventId?:string;occurredAt?:string;providerMessagesSent?:number;
 moneyMinorUnits?:number;retrySameNonceOnly?:boolean;committed?:null
}>;
