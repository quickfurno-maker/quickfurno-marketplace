export interface ScopedVoxContext {
 userId:string;role:string;teamId:string;cityId:string;
 prospectIds:readonly string[];vendorIds:readonly string[];
 supportThreadIds:readonly string[];conversationIds:readonly string[];
 canReadContent:boolean;canMutate:false;
 /** Present only after actual current independent department-grant review. */
 verifiedDepartments?:readonly string[];
}
export declare function resolveScopedStaff(input:{
 userId:string;identityVerified:boolean;
 membership:Record<string,unknown>|null;team:Record<string,unknown>|null;
 grants:Record<string,unknown>[]|null;now?:number
}):ScopedVoxContext|null;
export declare function filterHumanConversations(
 rows:Record<string,unknown>[],context:ScopedVoxContext,
 validatedProspectIds:readonly string[],validatedVendorIds:readonly string[]
):readonly Record<string,unknown>[];
