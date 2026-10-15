export interface WorkCandidate {
 id:string;team_id:string;city_id:string;
 source_kind:"prospect"|"vendor"|"support_thread";source_id:string;
 assignee_id:string|null;state:string;revision:number;updated_at:string;
}
export declare function selectScopedWorkCandidates(args:{
 scope:{userId:string;teamId:string;cityId:string};
 rows:readonly WorkCandidate[];
 verifiedProspectIds:readonly string[];verifiedVendorIds:readonly string[];
 verifiedSupportThreadIds:readonly string[];
}):{ok:true;rows:readonly WorkCandidate[]}|{ok:false;reason:string;rows:readonly []};
