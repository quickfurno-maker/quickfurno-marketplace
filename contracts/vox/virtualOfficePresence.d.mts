export type PresenceSnapshot={
 ok:true;schema:"qf.vox.virtual-office.team-presence.v1";
 mode:"EPHEMERAL_READ_ONLY";sourceVerified:true;rosterVerified:true;
 liveRealtimeConnected:false;asOf:string;boundedWindow:true;
 attendanceVerified:false;timeTrackingVerified:false;taskCompletionVerified:false;
 latestObservationsVerified:number;totalRosterKnown:true;unknownStaffCount:number;
 entries:{staffRef:string;state:string;source:"EPHEMERAL_ONLY"}[];
};
export declare function projectVerifiedTeamPresence(input:{
 viewer:{userId:string;teamId:string;cityId:string;role:"staff"|"team_leader"};
 roster:string[];observations:unknown[];nowMs:number;rosterVerified:boolean;
}):{ok:true;schema:"qf.vox.virtual-office.team-presence.v1";
 entries:readonly {staffId:string;state:string;source:"EPHEMERAL_ONLY"}[];
 totalRosterKnown:true;unknownStaffCount:number;attendanceVerified:false;
 timeTrackingVerified:false;taskCompletionVerified:false;
 latestObservationsVerified:number}|{ok:false;reason:string;attendanceVerified:false};
