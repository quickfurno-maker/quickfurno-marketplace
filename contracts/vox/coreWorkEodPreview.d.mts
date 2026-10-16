import type {ScopedVoxContext} from "./scopedStaff.mjs";
import type {EodCurrentVerifiedSources} from "./currentEodCanonicalProof.mjs";
export interface CoreWorkEodResult {
 ok:boolean;error?:string;schema?:string;mode?:string;actionsEnabled:false;
 businessDate?:string;source?:string;completeness?:string;
 sourceWatermark?:string;eventsIncluded?:number;
 counts?:Readonly<Record<string,number>>;
 canSubmit?:false;canAcknowledge?:false;canExport?:false;
 providerMessagesSent?:0;
}
export declare function projectCurrentCoreWorkEod(input:{
 scope:ScopedVoxContext;
 workItems:ReadonlyArray<Record<string,unknown>>;
 events:ReadonlyArray<Record<string,unknown>>;
 verifiedSourceIds:EodCurrentVerifiedSources;
 businessDate:string;
}):CoreWorkEodResult;
