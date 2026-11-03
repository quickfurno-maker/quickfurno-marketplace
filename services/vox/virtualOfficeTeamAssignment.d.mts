export type TlAssignIntent={itemId:string;targetStaffId:string;nonce:string;expectedRevision:number;reason:string};
export declare function validateTlAssignmentIntent(raw:unknown):{ok:true;intent:TlAssignIntent}|{ok:false;reason:string;applied:false};
export declare function assignScopedTeamWork(raw:unknown,deps:{
 environment:string;enabled:()=>boolean;reviewedWriterInstalled:()=>boolean;
 currentLeader:()=>Promise<unknown>;currentTarget:(id:string)=>Promise<unknown>;
 currentWork:(id:string)=>Promise<unknown>;
 rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>;
}):Promise<
 {ok:true;applied:true;itemId:string;targetStaffId:string;nonce:string;
 revision:number;externalMessagesSent:0;vendorAssignmentsChanged:0;moneyMinorUnits:0}|
 {ok:false;reason:string;committed?:null;retrySameNonceOnly?:true}
>;
