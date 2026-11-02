export type TlDecision="ACKNOWLEDGED"|"REJECTED";
export type TlPending={reportId:string;nonce:string;decision:TlDecision};
export type TlStore=Pick<Storage,"getItem"|"setItem"|"removeItem">|null;
export declare function readPendingTlReviews(store:TlStore):{available:boolean;records:TlPending[]};
export declare function savePendingTlReview(store:TlStore,row:TlPending):boolean;
export declare function clearPendingTlReview(store:TlStore,row:TlPending):boolean;
