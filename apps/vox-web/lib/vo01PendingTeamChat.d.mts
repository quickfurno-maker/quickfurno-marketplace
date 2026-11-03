export type PendingTeamChat={nonce:string;body:string};
export declare function readPendingTeamChat(store:Pick<Storage,"getItem">|null):{
 available:boolean;pending:PendingTeamChat|null;
};
export declare function savePendingTeamChat(store:Pick<Storage,"getItem"|"setItem">|null,
 row:PendingTeamChat):boolean;
export type VerifiedTeamChatReceipt={ok:true;status:201;nonce:string;messageId:string;
 effect:"INTERNAL_TEAM_MESSAGE_ONLY";externalMessagesSent:0;
 agentConversationChanged:false;staffPrivilegesChanged:false};
export declare function clearPendingTeamChat(store:Pick<Storage,"getItem"|"removeItem">|null,
 row:PendingTeamChat,receipt:VerifiedTeamChatReceipt):boolean;
