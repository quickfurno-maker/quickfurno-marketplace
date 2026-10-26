export type Ui04WorkspaceResult={ok:boolean;status?:number;
 reason?:string;items?:unknown[];[key:string]:unknown};
export function composeAuthorizedCoreWorkspace(args:{
 request:Request;
 featureGates:{work:string;client:string;portal:string;grants:string;departments:string};
 scope:unknown;
 verifyCurrentScope:(scope?:unknown)=>Promise<boolean>;
 readWorkHandler:(request:Request)=>Promise<Response>;
 readClientHandler:(request:Request)=>Promise<Response>;
 verifyCurrentObjectGrant:(arg:{scope:unknown;source:string;itemId:string;
  kind:string;expectedRevision:number;expectedState:string;
  expectedProjectId?:string})=>Promise<boolean>;
}):Promise<Ui04WorkspaceResult>;
