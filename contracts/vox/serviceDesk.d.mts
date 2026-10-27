export declare function projectStaffServiceDesk(input:{
 threads?:readonly Record<string,unknown>[];
 conversations?:readonly Record<string,unknown>[];
 context:{
 supportThreadIds:readonly string[];conversationIds:readonly string[];
 canReadContent:boolean;canMutate:false;
 };
 verifiedVendorIds?:readonly string[];
 verifiedProspectIds?:readonly string[];
 now?:number;
}):{
 schema:string;mode:"READ_ONLY";support:readonly unknown[];
 humanInbox:readonly unknown[];unsupportedUntilApproved:readonly string[];
};
export declare function proposeCaseAssignment(caseId:string,staffId:string,expectedRevision:number):{accepted:false;reason:string};
