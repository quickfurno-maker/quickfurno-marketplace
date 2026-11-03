export declare const OWNER_TEAM_TIME_SCHEMA:"qf.vox.owner.team-time-window.v1";
export type OwnerTeamTimeView={ok:true;schema:typeof OWNER_TEAM_TIME_SCHEMA;
 mode:"OWNER_READ_ONLY";source:"CORE_VERIFIED_CURRENT_SHIFTS";
 sourceVerified:true;rosterVerified:true;boundedWindow:true;
 windowSize:20;hasMore:boolean;completeHistory:false;officialEod:false;
 payrollVerified:false;livePresence:false;staffCount:number;asOf:string;
 states:{NOT_STARTED:number;CLOCKED_IN:number;ON_BREAK:number;
 TRACKING_TASK:number;CLOCKED_OUT:number};
 attendanceMs:number;breakMs:number;taskMs:number;unattributedMs:number;
 staff:ReadonlyArray<{staffRef:string;teamRef:string;status:string;
 attendanceMs:number;breakMs:number;taskMs:number;unattributedMs:number}>;
 providerMessagesSent:0;moneyMinorUnits:0};
export declare function buildVerifiedOwnerTeamTimeWindow(members:unknown,
 rows:unknown,opts:{ownerId:string;serverNowMs:number;rosterVerified:boolean;
 rowSourceVerified:boolean;hasMore:boolean}):
 OwnerTeamTimeView|{ok:false;reason:string;sourceVerified:false};
