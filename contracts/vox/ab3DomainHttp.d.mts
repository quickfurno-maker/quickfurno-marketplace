export function getAuthenticatedDomainWork(args:{
 request:Request;scope:unknown;enabled:boolean;
 readProtectedWork:(r:Request)=>Promise<Response>;
 verifyCurrentScope:(scope?:unknown)=>Promise<boolean>;
 verifyCurrentWorkObject:(x:{scope:unknown;department:string;itemId:string;kind:string;
 revision:number;state:string})=>Promise<boolean>;
}):Promise<{ok:boolean;status?:number;reason?:string;
 items?:unknown[];[key:string]:unknown}>;
