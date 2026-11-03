export declare function encodeHistoryCursor(row:{
 ended_at?:unknown;closed_by_event_nonce?:unknown
}|null):string|null;
export declare function decodeHistoryCursor(cursor:unknown,
 nowMs?:number):Readonly<{endedAt:string;nonce:string}>|null;
export declare function intervalHistoryKeysetFilter(cursor:unknown,
 nowMs?:number):string|null;
