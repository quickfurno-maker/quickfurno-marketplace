interface TaskAttempt {task_type:string;title:string;priority:string;description?:string|null;due_at:string|null;}
interface StoredTask extends TaskAttempt {vendor_id:string;created_by:string;}
export declare function sameVendorTaskCreate(existing:StoredTask|null|undefined,
 requested:TaskAttempt,vendorId:string,actor:string):boolean;
