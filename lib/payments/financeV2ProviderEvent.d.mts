export declare function prepareVerifiedRazorpayFinanceEvent(input:{
 rawBody:string;
 signature:string;
 webhookSecret:string;
 eventId:string;
 providerMode:"test"|"live";
 merchantAccountId:string;
}):Readonly<{
 provider:"razorpay";
 provider_mode:"test"|"live";
 merchant_account_id:string;
 provider_event_id:string;
 event_type:string;
 payload_sha256:string;
 signature_verified:true;
}>;
