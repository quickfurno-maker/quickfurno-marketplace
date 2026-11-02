export type PendingTeamChat={nonce:string;body:string};
export declare function readPendingTeamChat(store:Pick<Storage,"getItem">|null):{
 available:boolean;pending:PendingTeamChat|null;
};
export declare function savePendingTeamChat(store:Pick<Storage,"getItem"|"setItem">|null,
 row:PendingTeamChat):boolean;
export declare function clearPendingTeamChat(store:Pick<Storage,"getItem"|"removeItem">|null,
 row:PendingTeamChat):boolean;
