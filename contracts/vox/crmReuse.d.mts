export declare function projectAarohiWorkspace(input:{
 prospects?:readonly Record<string,any>[];
 tasks?:readonly Record<string,any>[];
 conversions?:readonly Record<string,any>[];
 scope:{cityId:string;prospectIds:readonly string[];vendorIds:readonly string[]}
}):{schema:string;owner:string;readOnly:true;prospects:readonly any[];tasks:readonly any[];links:readonly any[]};
export declare function projectVendor360(input:{
 vendors?:readonly Record<string,any>[];crm?:readonly Record<string,any>[];
 tasks?:readonly Record<string,any>[];
 scope:{vendorIds:readonly string[];validatedVendorIds:readonly string[]}
}):{schema:string;owner:string;readOnly:true;vendors:readonly any[];crm:readonly any[];tasks:readonly any[];
 paymentsEnabled:false;matchingEnabled:false;profileWritesEnabled:false};
