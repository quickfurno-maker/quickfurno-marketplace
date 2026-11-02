/** Owner Finance: canonical order + correlated Core payment record.
 * Strict, read-only. A payment record is NOT provider settlement evidence.
 */
import {projectRc7OwnerFinanceOrders} from "./rc7FinanceReadModel.mjs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES=new Set(["Pending","Paid","Failed","Refunded"]);
function money(v){
 if(typeof v==="number"&&!Number.isFinite(v))return null;
 if(typeof v!=="number"&&typeof v!=="string")return null;
 if(typeof v==="string"&&!/^\d{1,12}(?:\.\d{1,2})?$/.test(v))return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0&&n<=1e12&&Math.round(n*100)===n*100?n:null;
}
export function projectRc10FinanceOrderDetail(order,payment){
 const projected=projectRc7OwnerFinanceOrders([order]);
 if(!projected||projected.length!==1||!UUID.test(order.package_id??"")&&order.package_id!==null)
  return null;
 const item=projected[0];
 if(payment==null){
  if(["paid","refunded"].includes(item.paymentStatus))return null;
  return Object.freeze({order:item,ledger:null,source:"vendor_package_orders",
   ledgerStatus:"NO_CORRELATED_PAYMENT_RECORD",isAttemptHistoryComplete:false,
   providerConfirmed:false,canCapture:false,canRefund:false,canGrantCredits:false});
 }
 if(typeof payment!=="object"||Array.isArray(payment)||!UUID.test(payment.id??"")||
    payment.id!==order.id||payment.vendor_id!==order.vendor_id||
    (payment.package_id??null)!==(order.package_id??null)||
    !STATES.has(payment.payment_status)||typeof payment.created_at!=="string"||
    !Number.isFinite(Date.parse(payment.created_at)))
  return null;
 const paymentAmount=money(payment.amount);
 const price=money(order.package_price);
 if(paymentAmount===null||price===null||Math.round(paymentAmount*100)!==Math.round(price*100))
  return null;
 const translation={Pending:"pending",Paid:"paid",Failed:"failed",Refunded:"refunded"};
 if(translation[payment.payment_status]!==item.paymentStatus)return null;
 return Object.freeze({order:item,
  ledger:Object.freeze({recordedPaymentId:payment.id,recordedAmount:paymentAmount,
   recordedStatus:payment.payment_status,recordedAt:payment.created_at}),
  source:"vendor_package_orders+payments",ledgerStatus:"CORE_RECORDS_AGREE",
  isAttemptHistoryComplete:false,providerConfirmed:false,
  canCapture:false,canRefund:false,canGrantCredits:false});
}
