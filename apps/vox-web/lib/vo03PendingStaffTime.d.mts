export type PendingStaffTimeCommand={
 action:"CLOCK_IN"|"CLOCK_OUT"|"BREAK_START"|"BREAK_END"|
 "TASK_START"|"TASK_PAUSE"|"TASK_RESUME"|"TASK_STOP"|"TASK_SWITCH";
 nonce:string;expectedRevision:number;workItemId?:string;
};
export type CurrentStaffTimeReceipt={
 ok:true;schema:"qf.vox.staff.time.receipt.v1";nonce:string;eventId:string;
 revision:number;occurredAt:string;providerMessagesSent:0;moneyMinorUnits:0;
 productionCertified:false;
};
export declare const VO_PENDING_TIME_KEY:"qf.vox.pending-time-command.v1";
export declare function readPendingTimeCommand(store:Pick<Storage,"getItem">|null):
 {available:boolean;pending:PendingStaffTimeCommand|null};
export declare function savePendingTimeCommand(
 store:Pick<Storage,"getItem"|"setItem">|null,
 command:PendingStaffTimeCommand):boolean;
export declare function clearPendingTimeCommand(
 store:Pick<Storage,"getItem"|"removeItem">|null,
 command:PendingStaffTimeCommand,receipt:CurrentStaffTimeReceipt):boolean;
