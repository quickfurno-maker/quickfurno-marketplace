// Source fixtures for PAY-4C2; never initiate a Razorpay call.
export const razorpayTestMatrix=Object.freeze([
 {id:"TEST_CAPTURE_OK",event:"payment.captured",provider:"captured",expected:"PROVIDER_CAPTURE_CONFIRMED"},
 {id:"TEST_UNCAPTURED",event:"payment.captured",provider:"authorized",expected:"RETRY"},
 {id:"TEST_PAYMENT_FAILED",event:"payment.failed",provider:"failed",expected:"VERIFIED"},
 {id:"TEST_FAILED_EVENT_LATE_CAPTURE",event:"payment.failed",provider:"captured",expected:"RETRY"},
 {id:"TEST_WRONG_ORDER",event:"payment.captured",provider:"wrong_order",expected:"DEAD_LETTER"},
 {id:"TEST_WRONG_AMOUNT",event:"payment.captured",provider:"wrong_amount",expected:"DEAD_LETTER"},
 {id:"TEST_BAD_MERCHANT",event:"payment.captured",provider:"wrong_merchant",expected:"DEAD_LETTER"},
 {id:"TEST_LIVE_EVENT_IN_TEST",event:"payment.captured",provider:"wrong_mode",expected:"DEAD_LETTER"},
 {id:"TEST_PROVIDER_UNAVAILABLE",event:"payment.captured",provider:"offline",expected:"RETRY"}
]);
export function certificationMatrixReadiness(evidence={}){
 const required=[
 "realSandboxMerchantConfirmed","webhookSecretSeparatedFromLive",
 "stagingBackupApproved","independentAppsecApproved",
 "independentDbaApproved","ownerStagingAuthorization"
 ];
 const missing=required.filter(k=>evidence[k]!==true);
 return Object.freeze({matrixCount:razorpayTestMatrix.length,missing,
  readyForHumanReview:missing.length===0,executeSandboxPayment:false,
  executeRefund:false,actualSandboxTransactionsPerformed:false,
  independentCertificationRequired:true});
}
