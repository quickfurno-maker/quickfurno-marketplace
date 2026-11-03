export type TlAssignmentIntent={itemId:string;targetStaffId:string;nonce:string;expectedRevision:number;reason:string};
export type TlAssignmentReceipt={ok:true;schema:"qf.vox.tl.assignment.receipt.v1";itemId:string;targetStaffId:string;nonce:string;revision:number;externalMessagesSent:0;vendorAssignmentsChanged:0;moneyMinorUnits:0};
export declare const TL_PENDING_KEY:"qf.vox.pending-tl-assignment.v1";
export declare function validTlIntent(input:unknown):boolean;
export declare function loadPendingTl(store:Pick<Storage,"getItem">|null):{available:boolean;pending:TlAssignmentIntent|null};
export declare function savePendingTl(store:Pick<Storage,"getItem"|"setItem">|null,intent:TlAssignmentIntent):boolean;
export declare function clearPendingTl(store:Pick<Storage,"getItem"|"removeItem">|null,intent:TlAssignmentIntent,receipt:unknown):boolean;
