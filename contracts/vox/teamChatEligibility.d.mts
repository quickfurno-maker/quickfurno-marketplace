export function canReadWriteTeamInternalChat(args:{
 scope: null|{userId:string;teamId:string;cityId:string;role:string;
  canMutate:boolean;canReadContent:boolean;verifiedDepartments?:readonly string[]};
 teamLeaderEnabled:boolean;
}):boolean;
