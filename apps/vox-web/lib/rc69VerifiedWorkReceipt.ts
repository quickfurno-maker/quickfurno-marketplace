/** Exact Staff BFF receipt contract. Not a transaction authority: Core SQL,
 * current AAL2 and the immutable nonce ledger remain authoritative.
 */
const states={CLAIM:"ASSIGNED",START:"IN_PROGRESS",
 WAIT_EXTERNAL:"WAITING_EXTERNAL",REQUEST_APPROVAL:"WAITING_APPROVAL",
 BLOCK:"BLOCKED",RESUME:"IN_PROGRESS",COMPLETE:"DONE"} as const;
export type WorkReceiptAction=keyof typeof states;
type Expected={action:WorkReceiptAction;itemId:string;expectedRevision:number};
const KEYS=["affectsVendorLeadMatching","newState","ok","providerMessagesSent",
 "revision","schema","status","workItemId"].join("|");
export function isVerifiedWorkReceipt(value:unknown,command:Expected):boolean{
 if(!value||typeof value!=="object"||Array.isArray(value)||!command||
    !Object.prototype.hasOwnProperty.call(states,command.action)||
    !Number.isSafeInteger(command.expectedRevision)||
    command.expectedRevision<0||command.expectedRevision>2147483646)return false;
 const receipt=value as Record<string,unknown>;
 return Object.keys(receipt).sort().join("|")===KEYS&&
  receipt.ok===true&&receipt.status===200&&
  receipt.schema==="qf.vox.work.transaction.receipt.v1"&&
  receipt.workItemId===command.itemId&&
  receipt.newState===states[command.action]&&
  Number.isSafeInteger(receipt.revision)&&
  receipt.revision===command.expectedRevision+1&&
  receipt.providerMessagesSent===0&&
  receipt.affectsVendorLeadMatching===false;
}
