export interface Rc7FinancePreviewRow {
 id:string;vendor_id:string;package_price:number|string|null;package_currency:string;
 credits_included:number|null;order_status:string;payment_status:string;
 activation_status:string;created_at:string;
}
export interface Rc7FinanceItem {
 readonly orderId:string;readonly vendorRef:string;readonly currency:"INR";
 readonly recordedOrderAmount:number|null;readonly creditsIncluded:number|null;
 readonly orderStatus:string;readonly paymentStatus:string;
 readonly activationStatus:string;readonly createdAt:string;
}
export function projectRc7OwnerFinanceOrders(rows:unknown):readonly Rc7FinanceItem[]|null;
