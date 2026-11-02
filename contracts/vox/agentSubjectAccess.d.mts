export interface VoxSubjectQuery{agent:"AAROHI"|"ANISHA";subjectType:"prospect"|"vendor";subjectId:string;revision:number}
export interface VoxCoreStaffContext{userId:string;cityId:string;role:string;canReadContent:boolean;prospectIds:readonly string[];vendorIds:readonly string[];conversationIds:readonly string[]}
export declare const SCHEMA:"qf.vox.agent.subject.access.v1";
export declare function normalizeAgentSubjectAccess(input:unknown,scope:VoxCoreStaffContext):Readonly<VoxSubjectQuery>|null;
export declare function hasHumanCoreConversation(rows:unknown[],request:VoxSubjectQuery,scope:VoxCoreStaffContext):boolean;
