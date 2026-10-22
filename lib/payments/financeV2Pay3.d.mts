export type Pay3EventKind = "order"|"attempt"|"capture"|"refund"|"credit"|"settlement"|"audit";
export type Pay3Mode = "test"|"live";
export function financeTimeline(input:{
 providerMode:Pay3Mode;orderId:string;events:Array<{kind:Pay3EventKind;reference:string;
 occurredAt:string;amountSubunits:number|null;providerMode:Pay3Mode}>
}):ReadonlyArray<Readonly<{kind:Pay3EventKind;reference:string;occurredAt:string;
 amountSubunits:number|null;mode:Pay3Mode}>>;
export function evaluateVerifiedCapture(input:{expected:Record<string,unknown>;webhook:Record<string,unknown>}):Readonly<Record<string,unknown>>;
export function evaluateRefundProposal(input:Record<string,unknown>):Readonly<Record<string,unknown>>;
export function reconcileSettlement(input:Record<string,unknown>):Readonly<Record<string,unknown>>;
