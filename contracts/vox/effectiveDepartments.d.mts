import type {ScopedVoxContext} from "./scopedStaff.mjs";
export declare function restrictScopedStaffByDepartment(input:{
 scoped:ScopedVoxContext;
 capabilities:ReadonlyArray<Record<string,unknown>>;
 requests:ReadonlyArray<Record<string,unknown>>;
 decisions:ReadonlyArray<Record<string,unknown>>;
 activations:ReadonlyArray<Record<string,unknown>>;
 now?:number;
}):ScopedVoxContext|null;
