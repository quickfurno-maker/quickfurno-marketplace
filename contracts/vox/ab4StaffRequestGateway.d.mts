export function validateAb4StaffReviewRequest(body:unknown,ctx:{ownerId:string;now?:number}):{
ok:boolean;reason?:string;state?:string;insert?:Record<string,unknown>;
accountCreated:boolean;inviteSent:boolean;grantsActivated:boolean};
export function validateAb4StaffReviewDecision(body:unknown,ctx:{reviewerId:string}):{
ok:boolean;reason?:string;insert?:Record<string,unknown>;
accountCreated:boolean;inviteSent:boolean;grantsActivated:boolean};
