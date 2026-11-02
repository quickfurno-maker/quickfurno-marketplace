/** VOX RC7 owner-only Finance preview, source-only/read-only.
 * A package-order status is NOT provider-confirmed reconciliation.
 * This model never exposes Razorpay IDs, card data, UTR, tokens or vendor phone.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const PAYMENT=new Set(["not_started","pending","paid","failed","refunded"]);
const ACTIVATION=new Set(["not_activated","activated","failed"]);
const ORDER=new Set(["created","completed","cancelled","expired"]);
const finitePrice=v=>{
 if((typeof v!=="number"&&typeof v!=="string")||v===""||v===null)return null;
 if(typeof v==="string"&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(v))return null;
 const n=Number(v);
 return Number.isFinite(n)&&n>=0&&n<=1e12&&Math.round(n*100)===n*100?n:null;
};
export function projectRc7OwnerFinanceOrders(input){
 if(!Array.isArray(input)||input.length>21)return null;
 const out=[];
 for(const row of input){
  if(!row||typeof row!=="object"||Array.isArray(row)||!UUID.test(row.id??"")||
   !UUID.test(row.vendor_id??"")||!ORDER.has(row.order_status)||
   !PAYMENT.has(row.payment_status)||!ACTIVATION.has(row.activation_status)||
   row.package_currency!=="INR"||
   (row.package_price!==null&&finitePrice(row.package_price)===null)||
   (row.credits_included!==null&&(!Number.isSafeInteger(row.credits_included)||row.credits_included<0))||
   typeof row.created_at!=="string"||!Number.isFinite(Date.parse(row.created_at)))
   return null;
  const amount=finitePrice(row.package_price);
  // Intentionally no sensitive transaction IDs, provider IDs, payment method or
  // payment status derived from a callback; only source snapshot state is projected.
  out.push(Object.freeze({orderId:row.id,vendorRef:"VENDOR-"+row.vendor_id.slice(0,8),
   currency:"INR",recordedOrderAmount:amount,creditsIncluded:row.credits_included,
   orderStatus:row.order_status,paymentStatus:row.payment_status,
   activationStatus:row.activation_status,createdAt:row.created_at}));
 }
 return Object.freeze(out);
}
