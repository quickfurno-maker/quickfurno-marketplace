export function runAb5InAppOnlyBatch(args:{
 enabled:boolean;workerId:string;batch:number;leaseSeconds:number;
 privateWorkerAttested:boolean;
 claim:(args:{workerId:string;batch:number;leaseSeconds:number})=>Promise<unknown>;
 process:(args:{workerId:string;jobId:string;leaseToken:string})=>Promise<unknown>;
 fail:(args:{workerId:string;jobId:string;leaseToken:string;errorCode:string})=>Promise<unknown>;
}):Promise<unknown>;
