import type {ScopedVoxContext} from "./scopedStaff.mjs";
export interface EodCurrentReferences {
 ok:true;
 prospectIds:ReadonlyArray<string>;
 vendorIds:ReadonlyArray<string>;
 supportThreadIds:ReadonlyArray<string>;
}
export interface EodCurrentVerifiedSources {
 prospect:ReadonlyArray<string>;
 vendor:ReadonlyArray<string>;
 support_thread:ReadonlyArray<string>;
}
export type EodCurrentReferenceResult = EodCurrentReferences|
 {ok:false;reason:string};
export type EodCurrentCanonicalResult =
 {ok:true;verifiedSourceIds:EodCurrentVerifiedSources}|
 {ok:false;reason:string};
export declare function selectCurrentEodReferences(input:{
 scope:ScopedVoxContext;
 workItems:ReadonlyArray<Record<string,unknown>>;
}):EodCurrentReferenceResult;
export declare function verifyCurrentEodCanonicalProof(input:{
 scope:ScopedVoxContext;
 workItems:ReadonlyArray<Record<string,unknown>>;
 references:EodCurrentReferenceResult;
 prospects:ReadonlyArray<Record<string,unknown>>;
 vendors:ReadonlyArray<Record<string,unknown>>;
 zones:ReadonlyArray<Record<string,unknown>>;
 threads:ReadonlyArray<Record<string,unknown>>;
}):EodCurrentCanonicalResult;
