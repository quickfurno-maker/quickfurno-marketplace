export declare const OUTBOX_METRICS_ENVELOPE_SCHEMA:string;
export declare function isCoreStaffOutboxMetric(metric:unknown,now?:number):boolean;
export declare function signCoreOutboxMetricEnvelope(input:{
 metric:unknown;secret:string;jti:string;now?:number;
}):string;