export type EodPending={nonce:string;businessDate:string};
export type EodStore=Pick<Storage,"getItem"|"setItem"|"removeItem">|null;
export declare function indiaBusinessDate(now?:Date):string;
export declare function readPendingEodSubmission(store:EodStore):{available:boolean;pending:EodPending|null};
export declare function savePendingEodSubmission(store:EodStore,row:EodPending):boolean;
export declare function clearPendingEodSubmission(store:EodStore,row:EodPending):boolean;
