export type VendorWebhookEventBoundary =
 | Readonly<{kind:"invalid";reason:string}>
 | Readonly<{kind:"ignored";reason:string}>
 | Readonly<{kind:"captured"|"failed";paymentId:string;providerOrderId:string}>;
export function classifyVendorPackageWebhookEvent(event:unknown):VendorWebhookEventBoundary;
