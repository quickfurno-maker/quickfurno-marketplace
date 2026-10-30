import type {ScopedVoxContext} from "./scopedStaff.mjs";
export interface VoxWorkQueuePreviewResult {
 ok:boolean;schema?:string;mode?:string;actionsEnabled:false;
 boundedWindow?:boolean;completeness?:string;error?:string;
 items:ReadonlyArray<Record<string,unknown>>;
}
export declare function projectScopedWorkQueue(input:{
 scope:ScopedVoxContext;
 rows:ReadonlyArray<Record<string,unknown>>;
 verifiedProspectIds:readonly string[];
 verifiedVendorIds:readonly string[];
 verifiedSupportThreadIds:readonly string[];
}):VoxWorkQueuePreviewResult;
