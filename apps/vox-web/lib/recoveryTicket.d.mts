export type RecoveryPurpose="init"|"complete";
export function recoveryKey():string;
export function emailDigest(email:string):string;
export function issueRecoveryTicket(
 purpose:RecoveryPurpose,binding:string,key:string,now?:number
):string;
export function verifyRecoveryTicket(
 ticket:string|undefined,purpose:RecoveryPurpose,binding:string,key:string,now?:number
):boolean;
