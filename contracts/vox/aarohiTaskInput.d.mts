export interface ScopedAarohiTaskInput { prospectId:string; nonce:string; priority:"NORMAL"|"HIGH"; dueAt:string }
export interface ScopedAarohiTaskContext { userId:string; teamId:string; cityId:string; role:string; canReadContent:boolean; prospectIds:readonly string[] }
export declare function normalizeScopedAarohiTask(input:unknown,scope:ScopedAarohiTaskContext,now?:number):Readonly<{prospectId:string;nonce:string;priority:"NORMAL"|"HIGH";due_at:string}>|null;
