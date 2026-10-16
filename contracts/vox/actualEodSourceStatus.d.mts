import type {ScopedVoxContext} from "./scopedStaff.mjs";
export declare function projectActualStaffSourceStatus(input:{
 scope:ScopedVoxContext;
 businessDate:string;
 observations:ReadonlyArray<{
  source:string;readerState:string;currentScopeVerified:boolean;
  eventProvenance:string;
 }>
}):{ok:boolean;error?:string;[key:string]:unknown};