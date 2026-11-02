import type {ScopedVoxContext} from "./scopedStaff.mjs";
export declare function projectScopedClientCaseList(input:{
 scope:ScopedVoxContext;
 grants:ReadonlyArray<Record<string,unknown>>;
 conversations:ReadonlyArray<Record<string,unknown>>;
 leads:ReadonlyArray<Record<string,unknown>>;
 zones:ReadonlyArray<Record<string,unknown>>;
 now?:number;
}):{ok:boolean;error?:string;[key:string]:unknown};