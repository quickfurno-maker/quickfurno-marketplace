import test from "node:test";
import assert from "node:assert/strict";
import {evaluateManualBankReceiptReview as manual,evaluateConsumedCreditRefundSafety as credit,
 evaluateBankSettlementProof as bank} from "../../../lib/payments/financeV2Casework.mjs";
const uuid=x=>"10000000-0000-4000-8000-"+String(x).padStart(12,"0");
const evidence=()=>({paymentId:uuid(1),requesterId:uuid(2),reviewerId:uuid(3),
 reviewerAal2:true,approvalReference:uuid(4),method:"UPI",utr:" uTr00001 ",
 receivingAccountRef:"bank-ref-1",bankStatementSha256:"a".repeat(64),
 recordedAmountSubunits:12000,bankLineAmountSubunits:12000,
 bankStatementMatched:true,bankLineReference:"UTR00001",
 bankLineReceivingAccount:"bank-ref-1"});
test("PAY3B manual UTR policy requires independently matched bank line, never credits",()=>{
 const x=manual(evidence());assert.equal(x.reference,"UTR00001");
 assert.equal(x.walletCreditAllowed,false);assert.equal(x.paidStatusChangeAllowed,false);
});
test("PAY3B bank mismatches/self approval and non AAL2 all rejected",()=>{
 assert.throws(()=>manual({...evidence(),reviewerId:uuid(2)}),/UNTRUSTED/);
 assert.throws(()=>manual({...evidence(),reviewerAal2:false}),/UNTRUSTED/);
 assert.throws(()=>manual({...evidence(),bankLineAmountSubunits:11999}),/MISMATCH/);
 assert.throws(()=>manual({...evidence(),bankLineReference:"BAD"}),/MISMATCH/);
 assert.throws(()=>manual({...evidence(),bankStatementMatched:false}),/MISMATCH/);
});
test("PAY3C consumed vendor credits always require human policy",()=>{
 const x=credit({orderId:uuid(1),creditsPurchased:100,creditsConsumed:20,creditsRemaining:80});
 assert.equal(x.disposition,"OWNER_POLICY_REQUIRED");
 assert.equal(x.automaticCreditClawbackAllowed,false);
 assert.throws(()=>credit({orderId:uuid(1),creditsPurchased:100,creditsConsumed:20,creditsRemaining:90}),/UNTRUSTED/);
});
const proof=()=>({providerMode:"test",providerSettlementId:"setl_demo",bankReference:"utr_bank_1",
 statementSha256:"b".repeat(64),submittedBy:uuid(1),verifiedBy:uuid(2),
 reviewerAal2:true,providerDeclaredNetSubunits:10000,ledgerCalculatedNetSubunits:10000,
 bankDepositedSubunits:10000});
test("PAY3D bank 3-way proof labels amount matching but not revenue certification",()=>{
 const r=bank(proof());assert.equal(r.state,"THREE_WAY_AMOUNT_MATCH");
 assert.equal(r.releaseAllowed,false);assert.equal(r.revenueRecognitionCertified,false);
 assert.equal(bank({...proof(),bankDepositedSubunits:9999}).state,"THREE_WAY_DISCREPANCY");
});
test("PAY3D invalid bank proof, self review, and fractional units all denied",()=>{
 assert.throws(()=>bank({...proof(),verifiedBy:uuid(1)}),/INVALID/);
 assert.throws(()=>bank({...proof(),statementSha256:"bad"}),/INVALID/);
 assert.throws(()=>bank({...proof(),bankDepositedSubunits:10000.01}),/INVALID/);
});
