// P0 Finance: read-only credit-consumption reconciliation across supplied
// canonical source rows. A review aid, NEVER a provider/ledger/refund authority.
// Callers must independently attest row provenance in a governed DB snapshot.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const amount=x=>Number.isSafeInteger(x)&&x>=0;
const deny=reason=>Object.freeze({ok:false,reason,refundAllowed:false,
  creditRevocationAllowed:false,requiresHumanReview:true,verifiedDebits:0});
export function reviewVendorPackageCreditLedger(input){
 if(!input||typeof input!=="object"||Array.isArray(input)||
   Object.keys(input).sort().join("|")!==[
     "creditsGranted","creditsRemaining","ledgerDebits","orderId","vendorId"
   ].sort().join("|"))return deny("CREDIT_LEDGER_REVIEW_INPUT_INVALID");
 const {orderId,vendorId,creditsGranted,creditsRemaining,ledgerDebits}=input;
 if(!UUID.test(orderId)||!UUID.test(vendorId)||!amount(creditsGranted)||
    creditsGranted===0||!amount(creditsRemaining)||creditsRemaining>creditsGranted||
    !Array.isArray(ledgerDebits)||ledgerDebits.length>10000)
   return deny("CREDIT_LEDGER_REVIEW_SOURCE_INVALID");
 const seen=new Set();
 for(const row of ledgerDebits){
  if(!row||typeof row!=="object"||Array.isArray(row)||
    Object.keys(row).sort().join("|")!==["orderId","vendorId","leadId","credits"].sort().join("|")||
    row.orderId!==orderId||row.vendorId!==vendorId||
    !UUID.test(row.leadId)||row.credits!==1)
   return deny("CREDIT_LEDGER_DEBIT_SOURCE_INVALID");
  if(seen.has(row.leadId))return deny("CREDIT_LEDGER_DUPLICATE_LEAD_CHARGE");
  seen.add(row.leadId);
 }
 const consumed=creditsGranted-creditsRemaining;
 if(seen.size!==consumed)return deny("CREDIT_LEDGER_CONSUMPTION_MISMATCH");
 if(consumed>0)return deny("CREDIT_LEDGER_CONSUMED_REQUIRES_POLICY");
 return Object.freeze({ok:true,reason:"CREDIT_LEDGER_REVIEW_ONLY_UNCONSUMED",
   refundAllowed:false,creditRevocationAllowed:false,requiresHumanReview:true,
   verifiedDebits:0,reversibleCreditsForHumanReview:creditsRemaining});
}
