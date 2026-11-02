export interface ScopedSupportTaskInput{threadId:string;nonce:string;priority:string;dueAt:string}
export interface ScopedSupportTaskContext{userId:string;cityId:string;role:string;supportThreadIds:readonly string[]}
export declare function normalizeScopedSupportTask(input:unknown,scope:ScopedSupportTaskContext,now?:number):
Readonly<{threadId:string;task_type:"complaint";title:string;priority:string;due_at:string;idempotency_key:string}>|null;
