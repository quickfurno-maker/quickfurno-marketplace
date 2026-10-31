export const RAZORPAY_WEBHOOK_MAX_BYTES: number;
export function readBoundedRazorpayWebhookBody(request:Request):
 Promise<Readonly<{ok:true;rawBody:string}>|Readonly<{ok:false;code:string}>>;
