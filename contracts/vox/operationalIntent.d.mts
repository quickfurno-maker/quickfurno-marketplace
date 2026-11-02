export interface IntentScope {userId:string;teamId:string;cityId:string;role:string;
 prospectIds:readonly string[];vendorIds:readonly string[];supportThreadIds:readonly string[];}
export declare function normalizeOperationalIntent(data:unknown,scope:IntentScope):null|Readonly<{
 requester_id:string;team_id:string;city_id:string;action_kind:string;target_kind:string;
 target_id:string;nonce:string;rationale:string;}>;
