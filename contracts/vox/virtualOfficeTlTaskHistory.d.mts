export declare const TL_TASK_HISTORY_SCHEMA:"qf.vox.team.closed-task-intervals.v1";
export type TlTaskHistory={ok:true;schema:typeof TL_TASK_HISTORY_SCHEMA;
 mode:"TEAM_LEADER_READ_ONLY";source:"CORE_IMMUTABLE_TASK_INTERVALS";
 sourceVerified:true;rosterVerified:true;boundedWindow:true;
 asOf:string;windowSize:20;hasMore:boolean;nextCursor:string|null;completeHistory:false;
 attendanceVerified:false;payrollVerified:false;officialEod:false;
 livePresence:false;providerMessagesSent:0;moneyMinorUnits:0;
 entries:ReadonlyArray<{staffRef:string;workRef:string;startedAt:string;
 endedAt:string;elapsedMs:number;revision:number;
 closingAction:"TASK_PAUSE"|"TASK_STOP"|"TASK_SWITCH"|"BREAK_START"|"CLOCK_OUT"}>};
export declare function projectVerifiedTlTaskHistory(members:unknown,rows:unknown,
 opts:{leaderId:string;teamId:string;cityId:string;serverNowMs:number;
 rosterVerified:boolean;rowSourceVerified:boolean}):
 TlTaskHistory|{ok:false;reason:string;sourceVerified:false};
