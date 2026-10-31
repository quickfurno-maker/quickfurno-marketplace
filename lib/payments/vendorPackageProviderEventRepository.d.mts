import type {ProviderEventCompletion,RazorpayProviderEventEnvelope} from "./vendorPackageProviderEventLedger.mjs";
export const RC28_PROVIDER_LEDGER_RUNTIME_INSTALLED:false;
export function createRc28VendorPackageEventRepository(callRpc:
 (name:string,args:Record<string,unknown>)=>Promise<{data:unknown,error?:unknown}>):{
 claim(envelope:RazorpayProviderEventEnvelope):Promise<unknown>;
 complete(envelope:RazorpayProviderEventEnvelope,expected:Readonly<ProviderEventCompletion>):Promise<unknown>;
};
