export interface ScopedTaskInput {
 vendorId:string;nonce:string;taskType:string;title:string;priority:string;dueAt:string;
}
export interface ScopedTaskContext {
 userId:string;cityId:string;role:string;vendorIds:readonly string[];
}
export declare function normalizeScopedVendorTask(input:unknown,scope:ScopedTaskContext,now?:number):
 Readonly<{vendorId:string;idempotency_key:string;task_type:string;title:string;priority:string;due_at:string}>|null;
