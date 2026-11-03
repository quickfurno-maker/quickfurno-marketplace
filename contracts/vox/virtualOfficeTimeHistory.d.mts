export declare const TASK_INTERVAL_HISTORY_SCHEMA:"qf.vox.staff.task-intervals.v1";
export type TaskIntervalHistory={
 ok:true;schema:typeof TASK_INTERVAL_HISTORY_SCHEMA;
 source:"CORE_VERIFIED_TASK_INTERVALS";sourceVerified:true;
 mode:"OWN_STAFF_READ_ONLY";asOf:string;completeHistory:false;
 officialEod:false;payrollVerified:false;moneyMinorUnits:0;providerMessagesSent:0;
 windowSize:20;hasMore:boolean;
 entries:ReadonlyArray<{workItemId:string;startedAt:string;endedAt:string;
 elapsedMs:number;revision:number;
 closingAction:"TASK_PAUSE"|"TASK_STOP"|"TASK_SWITCH"|"BREAK_START"|"CLOCK_OUT"}>;
};
export declare function projectVerifiedTaskIntervals(rows:unknown,
 scope:{staffId:string;teamId:string;cityId:string;serverNowMs:number;
 sourceVerified:boolean}):TaskIntervalHistory|{ok:false;reason:string;sourceVerified:false};
