export interface F1CertifiedEodScope {
 userId:string;teamId:string;cityId:string;currentAal:"aal2";
 canReadContent:boolean;canMutate:false;
}
export interface F1EodDb {
 from(table:string):any;
}
export interface F1EodReaderResult {
 ok:boolean;reason?:string;mode:string;completeness:string;
 rollup:null|{totalEvents:number;readOnlyPreview:boolean};
 canSubmit:false;canExport?:false;providerMessagesSent:0;
 proof?:string;
}
export declare function sourceEventChecksum(events:readonly Record<string,unknown>[]):string;
export declare function signEodReaderWatermark(args:{
 row:Record<string,unknown>;secret:string
}):string;
export declare function readCertifiedFourSourceEod(args:{
 db:F1EodDb;scope:F1CertifiedEodScope;
 businessDate:string;secret:string;now?:number;
 verifyCurrentScope:(scope:F1CertifiedEodScope)=>Promise<boolean>;
 verifyExactObjectGrant:(grant:{
  actorId:string;teamId:string;cityId:string;source:string;
  subjectKind:string;subjectId:string;occurredAt:string
 })=>Promise<boolean>;
}):Promise<F1EodReaderResult>;
