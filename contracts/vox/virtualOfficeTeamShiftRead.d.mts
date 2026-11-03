export declare const TEAM_SHIFT_SCHEMA:"qf.vox.team.current-shifts.v1";
export type VerifiedTeamShift={ok:true;schema:typeof TEAM_SHIFT_SCHEMA;mode:"READ_ONLY";
 source:"CORE_CURRENT_SHIFT_ROWS";sourceVerified:true;rosterVerified:true;
 boundedWindow:true;completeHistory:false;officialEod:false;
 payrollVerified:false;livePresence:false;asOf:string;staffCount:number;
 states:Record<"NOT_STARTED"|"CLOCKED_IN"|"ON_BREAK"|"TRACKING_TASK"|"CLOCKED_OUT",number>;
 attendanceMs:number;breakMs:number;taskMs:number;netShiftMs:number;
 unattributedMs:number;staff:readonly {staffRef:string;status:string;
 attendanceMs:number;breakMs:number;taskMs:number;unattributedMs:number}[];
 providerMessagesSent:0;moneyMinorUnits:0};
export declare function buildVerifiedTeamShiftWindow(
 members:unknown,rows:unknown,opts:{leaderId:string;teamId:string;
 cityId:string;serverNowMs:number;rosterVerified:boolean;rowSourceVerified:boolean}
):VerifiedTeamShift|{ok:false;reason:string;sourceVerified:false};
