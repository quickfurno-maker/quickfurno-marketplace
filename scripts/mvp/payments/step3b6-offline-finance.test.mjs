import test from "node:test";
import assert from "node:assert/strict";
import {buildPay4c4UnsignedReleaseBill,verifyPay4c4DetachedSignature} from "./financePay4c4ReleaseBill.mjs";
import {runPay4c4OfflineProviderSuite,validateSyntheticWebhook} from "../../../lib/payments/financePay4c4OfflineProviderSuite.mjs";
const HEAD="06267c094e9aad9d55bbeef80ac955968c5b75be";
test("F offline provider scenarios certify zero payments or provider calls",()=>{
 const x=runPay4c4OfflineProviderSuite();
 assert.equal(x.passed,9);
 assert.equal(x.sandboxNetworkCalls,0);
 assert.equal(x.liveNetworkCalls,0);
 assert.equal(x.attemptedWalletCredits,0);
 assert.equal(x.refundsSubmitted,0);
 assert.equal(x.actualRazorpayTestCertified,false);
});
test("F release bill is unsigned and cannot authorize money or deployments",()=>{
 const x=buildPay4c4UnsignedReleaseBill({commitSha:HEAD});
 assert.equal(x.deployAllowed,false);
 assert.equal(x.artifactBuilt,false);
 assert.equal(x.sqlCount,12);
 assert.equal(x.fileCount,9);
});
test("F nonprovider/forged webhook is rejected",()=>{
 assert.equal(validateSyntheticWebhook("{}",null),false);
 assert.equal(validateSyntheticWebhook("{}","ff"),false);
});
test("F signature verification with no trust chain denies activation",()=>{
 const x=buildPay4c4UnsignedReleaseBill({commitSha:HEAD});
 const r=verifyPay4c4DetachedSignature({bill:x,signatureBase64:"AA==",publicKeyPem:"",expectedDigest:x.sha256});
 assert.equal(r.signatureValid,false);assert.equal(r.deployAllowed,false);
});
