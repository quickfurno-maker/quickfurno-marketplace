export declare const TIME_READ_SCHEMA:"qf.vox.staff.time.current-shift.v1";
export type VerifiedTimeStatus="NOT_STARTED"|"CLOCKED_IN"|"TRACKING_TASK"|"ON_BREAK"|"CLOCKED_OUT";
export type VerifiedTimeRead={ok:true;schema:typeof TIME_READ_SCHEMA;
 mode:"READ_ONLY";source:"CORE_CURRENT_SHIFT";sourceVerified:true;
 completeHistory:false;officialEod:false;payrollVerified:false;
 providerMessagesSent:0;moneyMinorUnits:0;asOf:string;status:VerifiedTimeStatus;
 revision:number;clockedInAt:string|null;clockedOutAt:string|null;
 activeWorkItemId:string|null;attendanceMs:number;breakMs:number;
 taskMs:number;netShiftMs:number;unattributedMs:number};
export declare function projectVerifiedStaffTimeRow(
 row:unknown,scope:{staffId:string;teamId:string;cityId:string;
 serverNowMs:number;sourceVerified:boolean}
):VerifiedTimeRead|{ok:false;reason:string;sourceVerified:false};
